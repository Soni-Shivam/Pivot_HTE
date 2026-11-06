// Worker evidence verification, done by each party's OWN client before releasing a key (PROTOCOL §9, SECURITY I2).
// Fail closed: anything not positively verified is a rejection. There is no "accept anyway" switch (I12).
import { verify as dcapVerify, getCollateral, PHALA_PCCS_URL, type Collateral } from '@phala/dcap-qvl'
import { sha512, sha384 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { publicKeyToAddress } from 'viem/accounts'
import { recoverMessageAddress, type Address, type Hex } from 'viem'
import { challengeDigest } from '@sealedai/protocol'

export const RUNTIME_NAMES: Record<number, string> = { 0: 'none (no TEE)', 1: 'TAPP TDX+GPU', 2: 'TAPP TDX', 3: '0G sealed sandbox', 4: 'dstack TDX+GPU' }

/** What a worker publishes at /v1/identity and /v1/challenge. */
export type WorkerEvidence = {
  runtime: number
  workerAddress: Address
  workerPubKey: Hex // uncompressed secp256k1, 0x04…
  imageDigest: string // e.g. sha256:…
  tapp?: { evidence: string } // base64 of {quote, cc_eventlog, runtime_data, gpu_evidence} as TAPP GetEvidence returns it
  reason?: string
}

export type GpuReportVerifier = (report: Uint8Array, certificate: string) => Promise<boolean>
export type EvidencePolicy = {
  nonce: Hex
  expectedImageDigest: string
  requireGpu: boolean
  allowedTcbStatus?: string[]
  pccsUrl?: string
  collateral?: Collateral // injected in tests; otherwise fetched from the PCCS
  now?: number
  gpuVerifier?: GpuReportVerifier // NVIDIA device attestation (NRAS or local verifier); none configured = reject
}
export type EvidenceVerdict = { runtime: number; workerAddress: Address; tcbStatus: string; gpus: number; imageDigest: string }

export class EvidenceRejected extends Error {}
const reject = (m: string): never => { throw new EvidenceRejected(m) }
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'))
function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

export { challengeDigest }

/** The worker must prove it holds the key the evidence names, for this exact nonce. */
export async function verifyChallenge(ev: WorkerEvidence, nonce: Hex, signature: Hex) {
  const signer = await recoverMessageAddress({ message: { raw: challengeDigest(nonce) }, signature })
  if (signer.toLowerCase() !== ev.workerAddress.toLowerCase()) reject('worker failed the key-possession challenge')
  if (publicKeyToAddress(ev.workerPubKey).toLowerCase() !== ev.workerAddress.toLowerCase()) reject('worker public key does not match its address')
}

export async function verifyWorkerEvidence(ev: WorkerEvidence, p: EvidencePolicy): Promise<EvidenceVerdict> {
  switch (ev.runtime) {
    case 1:
    case 2:
      return verifyTapp(ev, p)
    case 0:
      return reject(`no TEE evidence (${ev.reason ?? 'runtime none'}): keys are never released to an unattested worker`)
    default:
      return reject(`runtime ${ev.runtime} (${RUNTIME_NAMES[ev.runtime] ?? 'unknown'}) has no verifier in this build`)
  }
}

/** Intel DCAP quote check with dcap-qvl, locally (no attestation service to trust). */
export async function verifyQuote(quote: Uint8Array, p: Pick<EvidencePolicy, 'allowedTcbStatus' | 'pccsUrl' | 'collateral' | 'now'>) {
  const collateral = p.collateral ?? (await getCollateral(p.pccsUrl ?? PHALA_PCCS_URL, quote))
  let verified
  try {
    verified = dcapVerify(quote, collateral, p.now ?? Math.floor(Date.now() / 1000))
  } catch (e) {
    return reject(`quote verification failed: ${(e as Error).message}`)
  }
  const allowed = p.allowedTcbStatus ?? ['UpToDate']
  if (!allowed.includes(String(verified.status))) reject(`TCB status ${verified.status} is not allowed (${allowed.join(', ')})`)
  const td = verified.report.asTd10()
  if (!td) return reject('quote is not a TDX quote')
  if (td.tdAttributes[0] & 1) reject('TD is in DEBUG mode')
  return { status: String(verified.status), td }
}

async function verifyTapp(ev: WorkerEvidence, p: EvidencePolicy): Promise<EvidenceVerdict> {
  if (!ev.tapp?.evidence) return reject('TAPP evidence missing')
  const j = JSON.parse(Buffer.from(ev.tapp.evidence, 'base64').toString('utf8')) as {
    quote: string; cc_eventlog: string; runtime_data?: string; gpu_evidence?: { evidence_list: { cc_enabled: boolean; attestation_report: string; certificate: string }[] } | null
  }
  const { status, td } = await verifyQuote(b64(j.quote), p)
  if (!j.runtime_data) return reject('evidence predates runtime_data binding (tapp < 0.4.0)')
  const rdBytes = b64(j.runtime_data)
  const h = sha512(rdBytes)
  // Verify the binding FIRST, then read fields (EVIDENCE_AND_AS_VERIFICATION.md §4).
  if (!equalBytes(h, td.reportData)) reject('quote report_data does not bind runtime_data')
  const rd = JSON.parse(new TextDecoder().decode(rdBytes)) as { nonce?: string; signer?: string; app_id?: string }
  if ((rd.nonce ?? '').toLowerCase() !== p.nonce.toLowerCase()) reject('evidence is not fresh (nonce mismatch)')
  if ((rd.signer ?? '').toLowerCase() !== ev.workerAddress.toLowerCase()) reject('worker key is not the attested app signer')
  const events = replayAndCheckRtmr3(b64(j.cc_eventlog), td.rtMr3)
  const started = events.filter((e) => e.operation === 'start_app' && e.result === 'success').at(-1)
  if (!started) return reject('event log has no successful start_app')
  const digests = Object.values(started.image_hash ?? {}).map(String)
  if (!digests.includes(p.expectedImageDigest)) reject(`approved worker image ${p.expectedImageDigest} is not what was started`)
  let gpus = 0
  if (p.requireGpu) {
    const list = j.gpu_evidence?.evidence_list ?? []
    if (!list.length) reject('GPU evidence required but missing')
    if (!p.gpuVerifier) reject('no NVIDIA GPU attestation verifier configured')
    for (const g of list) {
      if (!g.cc_enabled) reject('a GPU is not in confidential-computing mode')
      const rep = b64(g.attestation_report)
      if (!equalBytes(rep.subarray(4, 36), h.subarray(0, 32))) reject('GPU report is not bound to this quote')
      if (!(await p.gpuVerifier!(rep, g.certificate))) reject('GPU attestation report failed NVIDIA verification')
      gpus++
    }
  }
  return { runtime: ev.runtime, workerAddress: ev.workerAddress, tcbStatus: status, gpus, imageDigest: p.expectedImageDigest }
}

export type TappEvent = { operation?: string; result?: string; image_hash?: Record<string, string>; compose_hash?: string; app_id?: string }

/** Parse the TCG2 CC event log, replay RTMR3 (SHA-384 chain) and require it to equal the quote's RTMR3.
 *  Only after the replay matches are the tapp.0g.com events trusted. */
export function replayAndCheckRtmr3(log: Uint8Array, quoteRtmr3: Uint8Array): TappEvent[] {
  const dv = new DataView(log.buffer, log.byteOffset, log.byteLength)
  const ALG: Record<number, number> = { 4: 20, 0xb: 32, 0xc: 48, 0xd: 64 }
  let o = 8 + 20
  o += 4 + dv.getUint32(o, true) // skip the SpecID header event
  let rtmr3 = new Uint8Array(48)
  const events: TappEvent[] = []
  while (o + 12 <= log.length) {
    const mr = dv.getUint32(o, true)
    const et = dv.getUint32(o + 4, true)
    const cnt = dv.getUint32(o + 8, true)
    o += 12
    let d384: Uint8Array | undefined
    for (let i = 0; i < cnt; i++) {
      const alg = dv.getUint16(o, true)
      o += 2
      const len = ALG[alg] ?? 48
      if (alg === 0xc) d384 = log.slice(o, o + len)
      o += len
    }
    const dl = dv.getUint32(o, true)
    o += 4
    const data = log.subarray(o, o + dl)
    o += dl
    if (mr === 4 && d384) rtmr3 = sha384(new Uint8Array([...rtmr3, ...d384])) // CC MR index 4 = RTMR3
    if (et === 0x6 && dl >= 8) {
      const tl = new DataView(data.buffer, data.byteOffset).getUint32(4, true)
      const text = new TextDecoder().decode(data.subarray(8, 8 + tl))
      const [domain, , ...rest] = text.split(' ')
      if (domain === 'tapp.0g.com' && mr === 4) {
        try { events.push(JSON.parse(rest.join(' '))) } catch { /* non-JSON tapp event */ }
      }
    }
  }
  if (!equalBytes(rtmr3, quoteRtmr3)) reject(`event log does not replay to the quote's RTMR3 (${bytesToHex(rtmr3).slice(0, 16)}…)`)
  return events
}
