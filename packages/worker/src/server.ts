// The sealed worker's control plane (PROTOCOL §5–§9). One job per worker instance. Keys live only in this
// process's memory; nothing secret is ever logged (the TAPP owner can read app logs). Every check fails closed.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { decrypt, encrypt } from 'eciesjs'
import { keccak256, stringToHex, bytesToHex, hexToBytes, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  openRequest, sealReply, canonical, jsonSafe, open as openObject, openChunked, seal, unpackTar,
  reviveTyped, recoverTyped, typedHash, typedData, commit, digestToBytes32, metric1e4, ROLE, JOB_DESCRIPTION_PREFIX,
  type Offer, type JobManifest, type KeyRelease, type TimelineEvent, ChannelError, challengeDigest,
} from '@sealedai/protocol'
import { runCustomization, catalogV1, catalogHash, type RunResult } from '@sealedai/planner'
import { escrow as escrowClient, storage, routerLlm } from '@sealedai/integrations'
import { MlPlane } from './mlplane.ts'
import type { EvidenceProvider } from './evidence.ts'

export type WorkerConfig = {
  rpcUrl: string
  storageIndexer: string
  routerUrl: string
  imageDigest: string // sha256:… of this worker image (what Offers pin)
  evidence: EvidenceProvider
  privateKey?: Hex // runtime-provided key (TAPP app signer); generated in memory otherwise
  escrow?: Address
  mlDir?: string
  scratchRoot?: string // memory-backed in the enclave
}

type Release = { key: Uint8Array; extras: Record<string, string> }
type Job = {
  offer: Offer; offerHash: Hex; manifest: JobManifest; manifestHash: Hex
  releases: Partial<Record<1 | 2, Release & { hash: Hex }>>
  status: 'quoted' | 'running' | 'done' | 'failed'
  timeline: TimelineEvent[]; error?: string
  result?: { reportRoot: Hex; wrappedReportKey: Hex; receipt: Record<string, unknown>; receiptSig: Hex; submitTx: Hex; run: RunResult }
  inferCalls: number
}

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg) } }
const fail = (status: number, msg: string): never => { throw new HttpError(status, msg) }
const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function createWorker(cfg: WorkerConfig) {
  const priv = cfg.privateKey ?? generatePrivateKey()
  const account = privateKeyToAccount(priv)
  const pubKey = account.publicKey
  const chain = escrowClient({ rpcUrl: cfg.rpcUrl, account: priv, escrow: cfg.escrow })
  const st = storage({ rpcUrl: cfg.rpcUrl, indexerUrl: cfg.storageIndexer, privateKey: priv })
  const seen = new Set<string>()
  const issuedEvidence = new Set<string>()
  let job: Job | undefined
  let ml: MlPlane | undefined
  let scratch: string | undefined

  async function identity(nonce?: Hex) {
    const tapp = await cfg.evidence.evidence(nonce)
    const ev = { runtime: cfg.evidence.runtime, workerAddress: account.address, workerPubKey: pubKey, imageDigest: cfg.imageDigest, ...(tapp && { tapp: { evidence: tapp } }), ...(cfg.evidence.reason && { reason: cfg.evidence.reason }) }
    issuedEvidence.add(keccak256(canonical(ev)))
    return { ...ev, escrow: chain.address, chainId: 16602 }
  }

  async function onManifest(from: Address, p: Record<string, unknown>) {
    if (job) fail(409, 'this worker already has a job')
    const offer = reviveTyped('Offer', p.offer as Record<string, unknown>)
    const manifest = reviveTyped('JobManifest', p.manifest as Record<string, unknown>)
    if (!eq(await recoverTyped('Offer', offer, p.offerSig as Hex, chain.address), offer.seller)) fail(400, 'offer is not signed by its seller')
    if (!eq(await recoverTyped('JobManifest', manifest, p.manifestSig as Hex, chain.address), manifest.buyer) || !eq(from, manifest.buyer)) fail(400, 'manifest is not signed by the requesting buyer')
    const offerHash = typedHash('Offer', offer, chain.address)
    const manifestHash = typedHash('JobManifest', manifest, chain.address)
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (manifest.offerHash !== offerHash || !eq(manifest.seller, offer.seller)) fail(400, 'manifest does not reference this offer')
    if (!eq(manifest.worker, account.address) || manifest.workerKeyHash !== keccak256(pubKey)) fail(400, 'manifest names another worker')
    if (Number(manifest.runtime) !== cfg.evidence.runtime || !issuedEvidence.has(manifest.evidenceHash)) fail(400, 'manifest evidence was not issued by this worker')
    if (offer.workerImageDigest !== digestToBytes32(cfg.imageDigest)) fail(400, 'the seller did not approve this worker image')
    if (BigInt(offer.validUntil) <= now || BigInt(manifest.expiresAt) <= now || BigInt(manifest.expiresAt) > BigInt(offer.validUntil)) fail(400, 'offer or manifest expired')
    if (Number(offer.maxTrainingRuns) > 2 || Number(offer.maxTrainingRuns) < 1) fail(400, 'invalid training run limit')
    const j = await chain.getJob(BigInt(manifest.jobId))
    if (j.status !== 'Open' || !eq(j.client, manifest.buyer) || !eq(j.provider, account.address) || !eq(j.evaluator, offer.seller)) fail(400, 'escrow job roles do not match the manifest')
    if (j.description !== `${JOB_DESCRIPTION_PREFIX}${manifestHash}` || BigInt(j.expiredAt) !== BigInt(manifest.expiresAt)) fail(400, 'escrow job does not commit to this manifest')
    job = { offer, offerHash, manifest, manifestHash, releases: {}, status: 'quoted', timeline: [], inferCalls: 0 }
    const payoutTx = await chain.setPayoutReceiver(BigInt(manifest.jobId), offer.seller as Address)
    const budgetTx = await chain.setBudget(BigInt(manifest.jobId), BigInt(offer.price), offer.token as Address)
    return { manifestHash, payoutTx, budgetTx }
  }

  async function onRelease(from: Address, p: Record<string, unknown>) {
    if (!job || job.status !== 'quoted') fail(409, 'no job awaiting key releases')
    const rel: KeyRelease = reviveTyped('KeyRelease', p.release as Record<string, unknown>)
    const role = Number(rel.role) as 1 | 2
    const expected = role === ROLE.seller ? job!.offer.seller : role === ROLE.buyer ? job!.manifest.buyer : fail(400, 'unknown role')
    if (!eq(await recoverTyped('KeyRelease', rel, p.sig as Hex, chain.address), expected as string) || !eq(from, expected as string)) fail(403, 'release not signed by that party')
    if (rel.manifestHash !== job!.manifestHash) fail(400, 'release is for another manifest')
    if (keccak256(p.wrapped as Hex) !== rel.wrappedKeyHash) fail(400, 'wrapped key does not match the signed release')
    const hash = typedHash('KeyRelease', rel, chain.address)
    const prior = job!.releases[role]
    if (prior && prior.hash !== hash) { job!.status = 'failed'; job!.error = 'conflicting key release'; fail(409, 'conflicting release: job aborted') }
    let key: Uint8Array
    try { key = decrypt(priv.slice(2), hexToBytes(p.wrapped as Hex)) } catch { return fail(400, 'wrapped key is not encrypted to this worker') }
    if (key.length !== 32) fail(400, 'object keys are 32 bytes')
    const extras = (p.extras ?? {}) as Record<string, string>
    if (role === ROLE.buyer) {
      if (commit(extras.goalSalt as Hex, keccak256(stringToHex(extras.goal ?? ''))) !== job!.manifest.goalCommitment) fail(400, 'goal does not match the manifest commitment')
      if (commit(extras.splitSalt as Hex, extras.splitSeed as Hex) !== job!.manifest.splitCommitment) fail(400, 'split seed does not match the manifest commitment')
      if (!extras.routerKey) fail(400, 'the buyer must provide a 0G Router key for the agent')
    }
    job!.releases[role] = { key, extras, hash }
    return { accepted: role === ROLE.seller ? 'model key' : 'dataset key', haveBoth: !!(job!.releases[1] && job!.releases[2]) }
  }

  async function onRun(from: Address) {
    if (!job || !eq(from, job.manifest.buyer)) fail(403, 'only the buyer starts the run')
    if (job!.status !== 'quoted') fail(409, `job is ${job!.status}`)
    if (!job!.releases[1] || !job!.releases[2]) fail(409, 'both parties must release their keys first (2-of-2)')
    const j = await chain.getJob(BigInt(job!.manifest.jobId))
    if (j.status !== 'Funded' || j.budget !== BigInt(job!.offer.price) || !eq(j.paymentToken, job!.offer.token as string) || !eq(j.payoutReceiver, job!.offer.seller as string)) fail(409, 'escrow job is not funded with the agreed terms')
    job!.status = 'running'
    void execute(job!).catch((e) => { job!.status = 'failed'; job!.error = String((e as Error).message).slice(0, 300) })
    return { started: true }
  }

  async function execute(jb: Job) {
    const seller = jb.releases[1]!, buyer = jb.releases[2]!
    // 1. Seller model: public bundle index → chunks → GCM-verified tar → commitment check → enclave tmpfs.
    const index = JSON.parse(new TextDecoder().decode(await st.downloadBlob(jb.offer.assetRoot as Hex))) as { manifestRoot: Hex; chunkRoots: Hex[]; objectId: string; version: number }
    const blobs = await Promise.all(index.chunkRoots.map((r) => st.downloadBlob(r)))
    const tar = openChunked(await st.downloadBlob(index.manifestRoot), blobs, seller.key, { objectType: 'model', objectId: index.objectId, version: index.version })
    if (commit(seller.extras.assetSalt as Hex, `0x${createHash('sha256').update(tar).digest('hex')}`) !== jb.offer.assetCommitment) throw new Error('model bundle does not match the offer commitment')
    scratch = mkdtempSync(join(cfg.scratchRoot ?? '/dev/shm', 'sealedai-'))
    for (const f of unpackTar(tar)) writeFileSync(join(scratch, f.name), f.data, { mode: 0o600 })
    ml = new MlPlane({ mlDir: cfg.mlDir })
    await ml.loadModel(scratch)
    const card = JSON.parse(new TextDecoder().decode(unpackTar(tar).find((f) => f.name === 'card.json')!.data))
    const catalog = catalogV1(card)
    if (catalogHash(catalog) !== jb.offer.recipeCatalogHash) throw new Error('recipe catalog does not match the offer')
    // 2. Buyer data.
    const ds = openObject(await st.downloadBlob(buyer.extras.datasetRoot as Hex), buyer.key, { objectType: 'dataset' })
    if (commit(buyer.extras.datasetSalt as Hex, `0x${ds.header.plaintextSha256}`) !== jb.manifest.datasetCommitment) throw new Error('dataset does not match the manifest commitment')
    const rows = new TextDecoder().decode(ds.plaintext).trim().split('\n').map((l) => JSON.parse(l))
    const { summary } = await ml.loadData(rows, buyer.extras.splitSeed)
    // 3. The customization loop (agent on 0G Private Computer, aggregates only).
    const run = await runCustomization({
      llm: routerLlm({ baseUrl: cfg.routerUrl, apiKey: buyer.extras.routerKey }),
      trainer: ml, catalog,
      budgets: { maxPlannerCalls: Number(jb.manifest.maxPlannerCalls), maxGpuSeconds: Number(jb.manifest.maxGpuSeconds), maxWallClockSec: Number(jb.manifest.maxWallClockSec), maxTrainingRuns: Number(jb.offer.maxTrainingRuns) },
      goal: buyer.extras.goal, card, summary,
      onEvent: (e) => jb.timeline.push(e),
    })
    // 4. Sealed report for the buyer only; receipt signed by the worker key; submit to escrow.
    const report = {
      protocol: 'sealedai/v1', runtime: cfg.evidence.runtime, manifestHash: jb.manifestHash, offerHash: jb.offerHash, task: card.task, architecture: card.architecture,
      recipeCatalogHash: jb.offer.recipeCatalogHash, split: summary.rows, baseline: run.baseline, runs: run.runs, selected: run.selected, rationale: run.rationale,
      holdout: run.holdout, stopReason: run.stopReason, budgetsUsed: { plannerCalls: run.plannerCalls, gpuSeconds: run.gpuSeconds }, timeline: run.timeline,
      timelineHead: run.timelineHead, evidence: { runtime: cfg.evidence.runtime, evidenceHash: jb.manifest.evidenceHash }, deps: { workerImageDigest: cfg.imageDigest },
    }
    const sealed = seal(canonical(jsonSafe(report)), { objectType: 'report', objectId: jb.manifestHash, version: 1 })
    const { root: reportRoot } = await st.uploadBlob(sealed.blob)
    const selected = run.selected === 'baseline' ? run.baseline : run.runs.find((r) => r.id === run.selected)!.metrics
    const receipt = {
      manifestHash: jb.manifestHash, jobId: BigInt(jb.manifest.jobId), reportRoot: reportRoot as Hex, reportCommitment: keccak256(sealed.blob),
      baselineValMetric: metric1e4(run.baseline.valMacroF1), selectedValMetric: metric1e4(selected.valMacroF1), holdoutMetric: metric1e4(run.holdout.valMacroF1),
      trainingRuns: run.runs.length, stopReason: run.stopReason, timelineHead: run.timelineHead as Hex, evidenceHash: jb.manifest.evidenceHash, runtime: cfg.evidence.runtime,
    }
    const receiptSig = await account.signTypedData(typedData('WorkerReceipt', receipt, chain.address) as never)
    const submitTx = await chain.submit(BigInt(jb.manifest.jobId), typedHash('WorkerReceipt', receipt, chain.address))
    const wrappedReportKey = bytesToHex(encrypt((jb.manifest.buyerSessionPubKey as string).slice(2), sealed.key))
    jb.result = { reportRoot: reportRoot as Hex, wrappedReportKey, receipt: jsonSafe(receipt) as Record<string, unknown>, receiptSig, submitTx, run }
    jb.status = 'done'
  }

  async function onInfer(from: Address, p: Record<string, unknown>) {
    if (!job || !eq(from, job.manifest.buyer)) fail(403, 'only the buyer may use the customized model')
    if (job!.status !== 'done' || !ml) fail(409, 'the customized model is not ready')
    if (job!.inferCalls >= Number(job!.manifest.maxInferenceCalls)) fail(429, 'license call limit reached')
    if (typeof p.text !== 'string' || p.text.length > 4000) fail(400, 'text must be a string of at most 4000 chars')
    job!.inferCalls++
    return { label: (await ml!.predict(job!.result!.run.selected, p.text as string)).label, callsUsed: job!.inferCalls, callsLimit: Number(job!.manifest.maxInferenceCalls) }
  }

  const sealedRoutes: Record<string, (from: Address, p: Record<string, unknown>) => Promise<unknown>> = {
    '/v1/manifest': onManifest,
    '/v1/release': onRelease,
    '/v1/run': (from) => onRun(from),
    '/v1/timeline': async (from, p) => {
      if (!job || !eq(from, job.manifest.buyer)) fail(403, 'only the buyer reads the timeline')
      return { status: job!.status, error: job!.error, events: job!.timeline.slice(Number(p.after ?? 0)) }
    },
    '/v1/result': async (from) => {
      if (!job || !eq(from, job.manifest.buyer)) fail(403, 'only the buyer reads the result')
      const { run: _run, ...r } = job!.result ?? ({} as NonNullable<Job['result']>)
      return { status: job!.status, error: job!.error, ...(job!.result && r) }
    },
    '/v1/infer': onInfer,
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks)
    const path = (req.url ?? '').split('?')[0]
    try {
      if (req.method === 'GET' && path === '/v1/identity') return json(res, 200, await identity())
      if (req.method === 'POST' && path === '/v1/challenge') {
        const { nonce } = JSON.parse(body.toString() || '{}') as { nonce?: Hex }
        if (!nonce || !/^0x[0-9a-fA-F]{64}$/.test(nonce)) fail(400, 'nonce must be 32 random bytes')
        return json(res, 200, { evidence: await identity(nonce), signature: await account.signMessage({ message: { raw: challengeDigest(nonce!) } }) })
      }
      const route = req.method === "POST" ? sealedRoutes[path] : undefined
      if (!route) fail(404, 'not found')
      const r = await openRequest(priv, new Uint8Array(body), path, seen)
      const out = await route!(r.from, r.payload)
      res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from(sealReply(r.replyTo, out)))
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof ChannelError ? 400 : 500
      json(res, status, { error: e instanceof HttpError || e instanceof ChannelError ? e.message : 'internal error' })
    }
  }
  const json = (res: ServerResponse, s: number, b: unknown) => res.writeHead(s, { 'content-type': 'application/json' }).end(JSON.stringify(jsonSafe(b)))

  const server = createServer((req, res) => void handle(req, res))
  return {
    address: account.address, pubKey,
    listen: (port: number, host = '127.0.0.1') => new Promise<void>((r) => server.listen(port, host, r)),
    close: () => { server.close(); ml?.close(); if (scratch) rmSync(scratch, { recursive: true, force: true }) },
    state: () => ({ status: job?.status, error: job?.error }),
  }
}
