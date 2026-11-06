// T09 (test run): one complete marketplace transaction on 0G Galileo + 0G Storage + 0G Private Computer, with real
// LoRA training, two wallets and the worker in this process.
//
// THIS HOST HAS NO TEE. The production verifier refuses this worker (shown first). To exercise everything else end to
// end, this script passes a TEST-ONLY verifier that accepts the unattested worker and says so on every line. Nothing
// produced here is confidential, and the data is synthetic (SECURITY I12).
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import { keccak256, stringToHex, parseEther, bytesToHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { canonical, commit, tag, typedData, typedHash, JOB_DESCRIPTION_PREFIX, type JobManifest } from '@sealedai/protocol'
import { escrow, routerLlm, erc8183Abi } from '@sealedai/integrations'
import { systemPrompt, catalogV1, validateRecipe } from '@sealedai/planner'
import { createWorker, NoTeeEvidence } from '@sealedai/worker'
import {
  publishModel, WorkerClient, verifyWorker, sellerRelease, sealDataset, localSummary, buyerRelease, acceptResult, verifyWorkerEvidence,
  type Verifier, type Result,
} from '@sealedai/client'

const env = { rpcUrl: process.env.RPC_URL!, indexerUrl: process.env.STORAGE_INDEXER! }
const hex = (k: string) => (k.startsWith('0x') ? k : `0x${k}`) as Hex
const sellerKey = hex(process.env.PRIVATE_KEY!), buyerKey = hex(process.env.BUYER_PRIVATE_KEY!)
const seller = privateKeyToAccount(sellerKey), buyer = privateKeyToAccount(buyerKey)
const sEsc = escrow({ rpcUrl: env.rpcUrl, account: sellerKey }), bEsc = escrow({ rpcUrl: env.rpcUrl, account: buyerKey })
const log: string[] = []
const say = (s: string) => { console.log(s); log.push(s) }
const rand32 = () => bytesToHex(randomBytes(32))

const TEST_ONLY_UNATTESTED: Verifier = async (ev) => {
  say(`  ⚠ TEST HARNESS: accepting UNATTESTED worker ${ev.workerAddress} (runtime ${ev.runtime}: ${ev.reason}). Not confidential.`)
  return { runtime: ev.runtime, workerAddress: ev.workerAddress, tcbStatus: 'NONE (test)', gpus: 0, imageDigest: ev.imageDigest }
}

// A dev image digest (the real one is the worker image's sha256 once built for the TEE).
const IMAGE = `sha256:${createHash('sha256').update('sealedai-worker-dev').digest('hex')}`
const worker = createWorker({ rpcUrl: env.rpcUrl, storageIndexer: env.indexerUrl, routerUrl: process.env.ZG_ROUTER_URL!, imageDigest: IMAGE, evidence: new NoTeeEvidence('dev server has no TDX (test run)') })
await worker.listen(8787)
const URL = 'http://127.0.0.1:8787'
say(`worker ${worker.address} listening (no TEE)`)

try {
  // ── Gas for the buyer and the worker (testnet 0G) ──
  if ((await sEsc.nativeBalance(buyer.address)) < parseEther('0.2')) say(`fund buyer gas tx ${await sEsc.sendGas(buyer.address, parseEther('0.3'))}`)

  // ── A. Seller lists ──
  const pub = await publishModel(env, seller, sellerKey, 'worker/ml/models/seller-triage-bert-mini', {
    price: 25_000_000n, validSeconds: 6 * 3600, maxTrainingRuns: 2, workerImageDigest: IMAGE, licenseCalls: 20, licenseHours: 1, requireGpu: false,
  })
  say(`A. seller published: assetRoot ${pub.offer.assetRoot} offerRoot ${pub.offerRoot} offerHash ${pub.offerHash}`)

  // ── B. Buyer prepares data, plans with the agent (numbers only), verifies the worker ──
  const rows = readFileSync('fixtures/buyer-isp-tickets.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const data = await sealDataset(env, buyerKey, rows)
  say(`B. buyer dataset sealed: root ${data.datasetRoot} (${rows.length} synthetic rows)`)
  const goal = 'Route our ISP support tickets. Outages are rare but must not be missed.'
  const summary = localSummary(rows)
  const planReply = await routerLlm({ baseUrl: process.env.ZG_ROUTER_URL!, apiKey: process.env.ZG_API_KEY! }).next([
    { role: 'system', content: systemPrompt(catalogV1(pub.card), { maxPlannerCalls: 10, maxGpuSeconds: 300, maxWallClockSec: 1200, maxTrainingRuns: 2 }) },
    { role: 'user', content: `PLANNING ONLY (no tools run yet). Buyer goal: ${JSON.stringify(goal)}. Card: ${JSON.stringify(pub.card)}. Data summary: ${JSON.stringify(summary)}. Reply with one propose_recipe call for the first run.` },
  ])
  const plan = JSON.parse(planReply.text.replace(/^```(json)?|```$/g, '').trim())
  validateRecipe(plan.args.recipe, catalogV1(pub.card))
  const planHash = keccak256(canonical(plan))
  say(`B. agent's proposed plan [${planReply.requestId.split(',')[0]}]: ${plan.args.reason ?? ''} → buyer approves (planHash ${planHash})`)

  const bw = new WorkerClient(URL, buyer)
  try { await verifyWorker(bw, { expectedImageDigest: IMAGE, requireGpu: false }) } catch (e) { say(`B. production verifier: REFUSED → ${(e as Error).message}`) }
  const v = await verifyWorker(bw, { expectedImageDigest: IMAGE, requireGpu: false }, TEST_ONLY_UNATTESTED)

  // ── C. Job, manifest, quote, funding ──
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3 * 3600)
  const jobId = ((await bEsc.pub.readContract({ address: bEsc.address, abi: erc8183Abi, functionName: 'jobCounter' })) as bigint) + 1n
  // shortcut: the manifest commits to the job id, so we predict jobCounter+1; a concurrent createJob makes us retry by hand.
  const goalSalt = rand32(), splitSalt = rand32(), splitSeed = rand32()
  const manifest: JobManifest = {
    offerHash: pub.offerHash, buyer: buyer.address, seller: seller.address, worker: v.evidence.workerAddress, workerKeyHash: keccak256(v.evidence.workerPubKey),
    evidenceHash: v.evidenceHash, runtime: BigInt(v.evidence.runtime), datasetCommitment: data.datasetCommitment, splitCommitment: commit(splitSalt, splitSeed),
    goalCommitment: commit(goalSalt, keccak256(stringToHex(goal))), planHash, plannerPolicyHash: tag('planner/v1'), outputPolicyHash: tag('labels-only/v1'),
    maxPlannerCalls: 10n, maxGpuSeconds: 300n, maxWallClockSec: 1200n, maxInferenceCalls: 20n, buyerSessionPubKey: bw.sessionPubKey, jobId, expiresAt,
  }
  const manifestHash = typedHash('JobManifest', manifest, bEsc.address)
  const created = await bEsc.createJob(v.evidence.workerAddress, seller.address, Number(expiresAt), `${JOB_DESCRIPTION_PREFIX}${manifestHash}`)
  if (created.jobId !== jobId) throw new Error(`job id race: expected ${jobId}, got ${created.jobId}; rerun`)
  say(`C. escrow job ${jobId} created tx ${created.tx}`)
  say(`C. worker gas tx ${await bEsc.sendGas(v.evidence.workerAddress, parseEther('0.05'))}`)
  const manifestSig = await buyer.signTypedData(typedData('JobManifest', manifest, bEsc.address) as never)
  const quote = await bw.call<{ payoutTx: string; budgetTx: string }>('/v1/manifest', { offer: pub.offer, offerSig: pub.offerSig, manifest, manifestSig })
  say(`C. worker quoted on chain: payout→seller tx ${quote.payoutTx}, budget tx ${quote.budgetTx}`)
  say(`C. mint test USDC tx ${await bEsc.mintTestToken(buyer.address, pub.offer.price as bigint)}`)
  const funded = await bEsc.fund(jobId, pub.offer.price as bigint)
  say(`C. funded: approve ${funded.approveTx} fund ${funded.fundTx}`)

  // ── C. Two-party key release: each party verifies the worker itself ──
  const sw = new WorkerClient(URL, seller)
  say(`C. seller release: ${JSON.stringify(await sellerRelease(env, seller, sw, pub, manifest, TEST_ONLY_UNATTESTED))}`)
  say(`C. buyer release: ${JSON.stringify(await buyerRelease(bEsc, buyer, bw, manifest, data, { goal, goalSalt, splitSalt, splitSeed, routerKey: process.env.ZG_API_KEY! }))}`)

  // ── D. Run: the agent customizes the model inside the worker ──
  await bw.call('/v1/run', {})
  let after = 0, status = 'running'
  while (status === 'running') {
    await new Promise((r) => setTimeout(r, 3000))
    const t = await bw.call<{ status: string; error?: string; events: { i: number; kind: string; requestId?: string; data: unknown }[] }>('/v1/timeline', { after })
    for (const e of t.events) say(`D. #${e.i} ${e.kind}${e.requestId ? ` [${e.requestId.split(',')[0]}]` : ''} ${JSON.stringify(e.data).slice(0, 200)}`)
    after += t.events.length
    status = t.status
    if (t.error) say(`D. error: ${t.error}`)
  }
  if (status !== 'done') throw new Error(`run ${status}`)

  // ── E. Result, acceptance, settlement ──
  const res = await bw.call<Result>('/v1/result', {})
  const { report } = await acceptResult(env, bw, manifest, res)
  say(`E. receipt accepted: report ${res.reportRoot}, submit tx ${res.submitTx}`)
  say(`E. baseline val F1 ${report.baseline.valMacroF1} → selected ${report.selected} → holdout F1 ${report.holdout.valMacroF1} (stop ${report.stopReason})`)
  say(`E. seller complete tx ${await sEsc.complete(jobId, tag('accepted'))}; seller test-USDC balance ${await sEsc.tokenBalance(seller.address)}`)

  // ── F. Use ──
  for (const text of ['no internet in Bandra since last night', 'my april bill has a fee I did not agree to', 'how do I port my number']) {
    const r = await bw.call<{ label: string; callsUsed: number }>('/v1/infer', { text })
    say(`F. infer ${JSON.stringify(text)} → ${r.label} (call ${r.callsUsed}/20)`)
  }
  say('TEST RUN COMPLETE: unattested worker, synthetic data. Every chain, storage and Router ID above is real.')
} finally {
  writeFileSync('docs/evidence/10-e2e-testnet.log', log.join('\n') + '\n')
  worker.close()
}
