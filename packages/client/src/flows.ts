// Seller and buyer flows (PLAN §4 A–F). Everything runs on the user's device: keys stay local, every worker is
// verified by THIS client before a key leaves it (SECURITY I1, I2), and receipts are checked before anyone pays (T05).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { PrivateKey, encrypt, decrypt } from 'eciesjs'
import { keccak256, encodeAbiParameters, bytesToHex, hexToBytes, type Address, type Hex, type LocalAccount } from 'viem'
import {
  canonical, jsonSafe, packTar, seal, sealChunked, open as openObject, sealRequest, openReply, typedData, typedHash, recoverTyped,
  commit, tag, digestToBytes32, metric1e4, verifyTimeline, ROLE, JOB_DESCRIPTION_PREFIX,
  type Offer, type JobManifest, type WorkerReceipt, type TimelineEvent,
} from '@sealedai/protocol'
import { catalogV1, catalogHash } from '@sealedai/planner'
import { storage, escrow as escrowClient, type Escrow } from '@sealedai/integrations'
import { verifyWorkerEvidence, verifyChallenge, type WorkerEvidence, type EvidencePolicy, type EvidenceVerdict } from './evidence.ts'

export type Env = { rpcUrl: string; indexerUrl: string; escrow?: Address }
export type Verifier = (ev: WorkerEvidence, p: EvidencePolicy) => Promise<EvidenceVerdict>
const rand32 = () => bytesToHex(randomBytes(32))
const sha256Hex = (b: Uint8Array) => `0x${createHash('sha256').update(b).digest('hex')}` as Hex
const BUNDLE_FILES = new Set(['config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt', 'card.json'])

// ── Seller ────────────────────────────────────────────────────────────────────────────────────────────────────
export type Terms = { price: bigint; validSeconds: number; maxTrainingRuns: 1 | 2; workerImageDigest: string; licenseCalls: number; licenseHours: number; requireGpu: boolean }

export async function publishModel(env: Env, seller: LocalAccount, privateKey: Hex, bundleDir: string, t: Terms) {
  const files = readdirSync(bundleDir).filter((f) => BUNDLE_FILES.has(f)).map((name) => ({ name, data: new Uint8Array(readFileSync(join(bundleDir, name))) }))
  const card = JSON.parse(new TextDecoder().decode(files.find((f) => f.name === 'card.json')!.data))
  const tar = packTar(files)
  const st = storage({ rpcUrl: env.rpcUrl, indexerUrl: env.indexerUrl, privateKey })
  const objectId = `asset-${bytesToHex(randomBytes(8)).slice(2)}`
  const s = sealChunked(tar, { objectType: 'model', objectId, version: 1 })
  const chunkRoots: string[] = []
  for (const b of s.blobs) chunkRoots.push((await st.uploadBlob(b)).root)
  const manifestRoot = (await st.uploadBlob(s.manifestBlob)).root
  // Public index: ciphertext roots only, nothing secret.
  const assetRoot = (await st.uploadBlob(canonical({ schema: 'sealedai.bundle-index/v1', objectId, version: 1, manifestRoot, chunkRoots }))).root as Hex
  const esc = escrowClient({ rpcUrl: env.rpcUrl, escrow: env.escrow })
  const assetSalt = rand32()
  const offer: Offer = {
    seller: seller.address,
    assetId: keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'string' }], ['sealedai.asset', 16602n, seller.address, objectId])),
    assetVersion: 1n, assetCommitment: commit(assetSalt, sha256Hex(tar)), assetRoot,
    format: tag('hf-safetensors/v1'), task: tag(card.task), architecture: tag(card.architecture),
    recipeCatalogHash: catalogHash(catalogV1(card)) as Hex, workerImageDigest: digestToBytes32(t.workerImageDigest),
    evidencePolicyHash: keccak256(canonical({ runtimes: [1, 2], requireGpu: t.requireGpu, tcb: ['UpToDate'] })),
    token: esc.token, price: t.price,
    licenseHash: keccak256(canonical({ calls: t.licenseCalls, hours: t.licenseHours, scope: 'hosted-inference', adapterExport: false })),
    maxTrainingRuns: BigInt(t.maxTrainingRuns), validUntil: BigInt(Math.floor(Date.now() / 1000) + t.validSeconds), offerNonce: BigInt(rand32()),
  }
  const offerSig = await seller.signTypedData(typedData('Offer', offer, esc.address) as never)
  const offerRoot = (await st.uploadBlob(canonical(jsonSafe({ offer, offerSig, card, license: { calls: t.licenseCalls, hours: t.licenseHours } })))).root
  return { offer, offerSig, offerHash: typedHash('Offer', offer, esc.address), offerRoot, card, assetKey: s.key, assetSalt }
}

// ── Talking to a worker ───────────────────────────────────────────────────────────────────────────────────────
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
    const r = await fetch(`${this.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from(body) })
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

// ── Seller: release the model key to a verified worker for an exact, funded job ─────────────────────────────
export async function sellerRelease(env: Env, seller: LocalAccount, w: WorkerClient, published: { offer: Offer; offerHash: Hex; assetKey: Uint8Array; assetSalt: Hex }, manifest: JobManifest, verifier?: Verifier) {
  const { evidence } = await verifyWorker(w, { expectedImageDigest: `sha256:${published.offer.workerImageDigest.slice(2)}`, requireGpu: false }, verifier)
  const esc = escrowClient({ rpcUrl: env.rpcUrl, escrow: env.escrow })
  const manifestHash = typedHash('JobManifest', manifest, esc.address)
  if (manifest.offerHash !== published.offerHash || manifest.seller.toLowerCase() !== seller.address.toLowerCase()) throw new Error('manifest is not for my offer')
  if (manifest.worker.toLowerCase() !== evidence.workerAddress.toLowerCase() || manifest.workerKeyHash !== keccak256(evidence.workerPubKey)) throw new Error('manifest names a different worker than the one I verified')
  const j = await esc.getJob(BigInt(manifest.jobId))
  const ok = j.status === 'Funded' && j.client.toLowerCase() === manifest.buyer.toLowerCase() && j.provider.toLowerCase() === evidence.workerAddress.toLowerCase() &&
    j.evaluator.toLowerCase() === seller.address.toLowerCase() && j.payoutReceiver.toLowerCase() === seller.address.toLowerCase() &&
    j.budget === BigInt(published.offer.price) && j.paymentToken.toLowerCase() === published.offer.token.toLowerCase() && j.description === `${JOB_DESCRIPTION_PREFIX}${manifestHash}`
  if (!ok) throw new Error('escrow job is not funded on my terms')
  const wrapped = bytesToHex(encrypt(evidence.workerPubKey.slice(2), published.assetKey))
  const release = { manifestHash, role: BigInt(ROLE.seller), objectId: published.offer.assetId, wrappedKeyHash: keccak256(wrapped) }
  const sig = await seller.signTypedData(typedData('KeyRelease', release, esc.address) as never)
  return w.call('/v1/release', { release, sig, wrapped, extras: { assetSalt: published.assetSalt } })
}

// ── Buyer ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function sealDataset(env: Env, privateKey: Hex, rows: { text: string; label: string }[]) {
  const st = storage({ rpcUrl: env.rpcUrl, indexerUrl: env.indexerUrl, privateKey })
  const s = seal(new TextEncoder().encode(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'), { objectType: 'dataset', objectId: `ds-${bytesToHex(randomBytes(8)).slice(2)}`, version: 1 })
  const datasetRoot = (await st.uploadBlob(s.blob)).root as Hex
  const datasetSalt = rand32()
  return { datasetRoot, datasetKey: s.key, datasetSalt, datasetCommitment: commit(datasetSalt, `0x${s.header.plaintextSha256}`) }
}

/** Numeric summary computed on the buyer's device: all the planning agent may see (I9). */
export function localSummary(rows: { text: string; label: string }[]) {
  const hist: Record<string, number> = {}
  for (const r of rows) hist[r.label] = (hist[r.label] ?? 0) + 1
  const lens = rows.map((r) => r.text.split(/\s+/).length).sort((a, b) => a - b)
  const q = (x: number) => lens[Math.min(lens.length - 1, Math.floor(x * lens.length))] ?? 0
  return { rows: { train: Math.round(rows.length * 0.6), val: Math.round(rows.length * 0.2) }, labelHistogram: hist, tokenLenP50: q(0.5), tokenLenP95: q(0.95) }
}

export function buyerRelease(esc: Escrow, buyer: LocalAccount, w: WorkerClient, manifest: JobManifest, d: { datasetRoot: Hex; datasetKey: Uint8Array; datasetSalt: Hex }, secrets: { goal: string; goalSalt: Hex; splitSalt: Hex; splitSeed: Hex; routerKey: string }) {
  return (async () => {
    const manifestHash = typedHash('JobManifest', manifest, esc.address)
    const wrapped = bytesToHex(encrypt(w.workerPubKey!.slice(2), d.datasetKey))
    const release = { manifestHash, role: BigInt(ROLE.buyer), objectId: keccak256(d.datasetRoot), wrappedKeyHash: keccak256(wrapped) }
    const sig = await buyer.signTypedData(typedData('KeyRelease', release, esc.address) as never)
    return w.call('/v1/release', { release, sig, wrapped, extras: { datasetRoot: d.datasetRoot, datasetSalt: d.datasetSalt, ...secrets } })
  })()
}

export type Result = { status: string; error?: string; reportRoot: Hex; wrappedReportKey: Hex; receipt: Record<string, string>; receiptSig: Hex; submitTx: Hex }

/** T05: accept a result only if the worker-signed receipt, the sealed report and the manifest all agree. */
export async function acceptResult(env: Env, w: WorkerClient, manifest: JobManifest, res: Result) {
  const esc = escrowClient({ rpcUrl: env.rpcUrl, escrow: env.escrow })
  const manifestHash = typedHash('JobManifest', manifest, esc.address)
  const r = res.receipt
  const receipt: WorkerReceipt = {
    manifestHash: r.manifestHash as Hex, jobId: BigInt(r.jobId), reportRoot: r.reportRoot as Hex, reportCommitment: r.reportCommitment as Hex,
    baselineValMetric: BigInt(r.baselineValMetric), selectedValMetric: BigInt(r.selectedValMetric), holdoutMetric: BigInt(r.holdoutMetric),
    trainingRuns: BigInt(r.trainingRuns), stopReason: BigInt(r.stopReason), timelineHead: r.timelineHead as Hex, evidenceHash: r.evidenceHash as Hex, runtime: BigInt(r.runtime),
  }
  const signer = await recoverTyped('WorkerReceipt', receipt, res.receiptSig, esc.address)
  const must = (c: boolean, m: string) => { if (!c) throw new Error(`receipt rejected: ${m}`) }
  must(signer.toLowerCase() === manifest.worker.toLowerCase(), 'not signed by the manifest worker')
  must(receipt.manifestHash === manifestHash && receipt.jobId === BigInt(manifest.jobId), 'wrong manifest or job')
  must(receipt.evidenceHash === manifest.evidenceHash && receipt.runtime === BigInt(manifest.runtime), 'evidence or runtime differs from what was verified')
  const blob = await storage({ rpcUrl: env.rpcUrl, indexerUrl: env.indexerUrl }).downloadBlob(res.reportRoot)
  must(keccak256(blob) === receipt.reportCommitment, 'report does not match the receipt')
  const key = new Uint8Array(decrypt(w.session.secret, hexToBytes(res.wrappedReportKey)))
  const report = JSON.parse(new TextDecoder().decode(openObject(blob, key, { objectType: 'report', objectId: manifestHash }).plaintext)) as {
    manifestHash: Hex; timeline: TimelineEvent[]; holdout: { valMacroF1: number }; baseline: { valMacroF1: number }; runs: unknown[]; selected: string; rationale: string; stopReason: number
  }
  must(report.manifestHash === manifestHash, 'report is for another manifest')
  verifyTimeline(report.timeline, receipt.timelineHead)
  must(metric1e4(report.holdout.valMacroF1) === Number(receipt.holdoutMetric), 'holdout metric differs from the signed receipt')
  const j = await esc.getJob(BigInt(manifest.jobId))
  must(j.status === 'Submitted' || j.status === 'Completed', `escrow job is ${j.status}`)
  return { receipt, report }
}
