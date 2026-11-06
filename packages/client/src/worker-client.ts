// Browser-safe: talking to a worker and verifying it (no Node APIs), shared by the CLI and the web app.
import { PrivateKey } from 'eciesjs'
import { keccak256, bytesToHex, type Hex, type LocalAccount } from 'viem'
import { randomBytes } from '@noble/hashes/utils.js'
import { canonical, sealRequest, openReply } from '@sealedai/protocol'
import { verifyWorkerEvidence, verifyChallenge, type WorkerEvidence, type EvidencePolicy, type EvidenceVerdict } from './evidence.ts'

export type Verifier = (ev: WorkerEvidence, p: EvidencePolicy) => Promise<EvidenceVerdict>
const rand32 = () => bytesToHex(randomBytes(32))

export class WorkerClient {
  readonly session = new PrivateKey() // replies (and the buyer's report key) are encrypted to this
  workerPubKey?: Hex
  constructor(readonly url: string, readonly account: LocalAccount) {}
  get sessionPubKey() { return `0x${this.session.publicKey.toHex(false)}` as Hex }

  async challenge() {
    const nonce = rand32()
    const r = await fetch(`${this.url}/v1/challenge`, { method: 'POST', body: JSON.stringify({ nonce }) })
    if (!r.ok) throw new Error(`challenge failed: ${await r.text()}`)
    const { evidence, signature } = (await r.json()) as { evidence: WorkerEvidence & { escrow?: string; chainId?: number }; signature: Hex }
    return { nonce, evidence, signature }
  }

  async call<T>(path: string, payload: unknown): Promise<T> {
    if (!this.workerPubKey) throw new Error('verify the worker before sending it anything')
    const body = await sealRequest(this.workerPubKey, path, payload, this.account, this.sessionPubKey)
    const r = await fetch(`${this.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: body as BodyInit })
    if (!r.ok) throw new Error(`${path}: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status}`)
    return openReply<T>(bytesToHex(this.session.secret), new Uint8Array(await r.arrayBuffer()))
  }
}

/** Fresh challenge → key possession → evidence policy. Only after this may the client send the worker anything. */
export async function verifyWorker(w: WorkerClient, p: Omit<EvidencePolicy, 'nonce'>, verifier: Verifier = verifyWorkerEvidence) {
  const { nonce, evidence, signature } = await w.challenge()
  const { escrow: _e, chainId: _c, ...ev } = evidence
  await verifyChallenge(ev, nonce, signature)
  const verdict = await verifier(ev, { ...p, nonce })
  w.workerPubKey = ev.workerPubKey
  return { evidence: ev, evidenceHash: keccak256(canonical(ev)), verdict }
}


/** Numeric summary computed on the buyer's device: all the planning agent may see (I9). */
export function localSummary(rows: { text: string; label: string }[]) {
  const hist: Record<string, number> = {}
  for (const r of rows) hist[r.label] = (hist[r.label] ?? 0) + 1
  const lens = rows.map((r) => r.text.split(/\s+/).length).sort((a, b) => a - b)
  const q = (x: number) => lens[Math.min(lens.length - 1, Math.floor(x * lens.length))] ?? 0
  return { rows: { train: Math.round(rows.length * 0.6), val: Math.round(rows.length * 0.2) }, labelHistogram: hist, tokenLenP50: q(0.5), tokenLenP95: q(0.95) }
}

