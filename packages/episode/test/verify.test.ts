import { test } from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { aggregatesOk, checkPublic, recomputeMetrics } from '../src/check.ts'
import { publicJson, readRun, sealedTar, sealRun } from '../src/bundle.ts'
import { archiveTee, checkTee, verify, type TeeDeps } from '../src/verify.ts'
import { readFileSync } from 'node:fs'
import { checkArchived, signedScheme, type Service } from '../src/tee.ts'

const dir = new URL('./fixtures/run-kinematic', import.meta.url).pathname
const run = readRun(dir)
const pub = JSON.parse(new TextDecoder().decode(publicJson(run)))

test('metrics recompute from the LiDAR fields and catch an edited ccs', () => {
  const c = checkPublic(pub)
  assert.equal(c.metricsRecomputedOk, true)
  assert.equal(c.filesOk, true)
  assert.equal(c.decisionsOk, true)
  const lines = pub.trajectory_jsonl.trim().split('\n').map((l: string) => JSON.parse(l))
  const i = lines.findIndex((l: { ccs: number | null }) => l.ccs !== null && l.ccs > 0.01)
  lines[i].ccs += 1e-6
  assert.equal(recomputeMetrics(lines).ok, false)
  const edited = { ...pub, trajectory_jsonl: lines.map((l: unknown) => JSON.stringify(l)).join('\n') + '\n' }
  const c2 = checkPublic(edited)
  assert.equal(c2.metricsRecomputedOk, false)
  assert.equal(c2.filesOk, false) // the raw bytes no longer hash to manifest.files
})

test('headline aggregates must follow from the rows', () => {
  const lines = pub.trajectory_jsonl.trim().split('\n').map((l: string) => JSON.parse(l))
  const met = JSON.parse(pub.metrics_json)
  assert.equal(aggregatesOk(lines, met, pub.manifest), true)
  assert.equal(aggregatesOk(lines, { ...met, ccs: 1.0 }, pub.manifest), false)
  assert.equal(aggregatesOk(lines, { ...met, min_ttc_s: 0.5 }, pub.manifest), false)
  assert.equal(aggregatesOk(lines, met, { ...pub.manifest, collision: true }), false)
})

// A fake provider whose TEE key we hold: signs text exactly as the broker does (EIP-191 over "<sha>:<sha>").
const key = generatePrivateKey()
const acct = privateKeyToAccount(key)
const svc = (o: Partial<Service> = {}): Service => ({ provider: '0xprov', url: 'https://p.invalid', model: 'M', verifiability: 'TeeML',
  additionalInfo: '{"TargetSeparated":false}', teeSignerAddress: acct.address, teeSignerAcknowledged: true, ...o })
const zgPub = { ...pub, decisions: pub.decisions.map((d: any, i: number) => ({ ...d, source: '0g', provider: '0xprov', zg_res_key: `k${i}` })) }
const deps = (s = svc(), skip = new Set<string>()): TeeDeps => ({
  readService: async () => s,
  fetchQuote: async () => ({ report_data: btoa(acct.address + '\0'.repeat(22)) }),
  fetchSignature: async (_s, chatId) => {
    if (skip.has(chatId)) throw new Error('HTTP 404')
    const text = `${'a'.repeat(64)}:${'b'.repeat(64)}`
    return { text, signature: await acct.signMessage({ message: text }) }
  },
})

test('archived signatures verify offline against the on-chain signer', async () => {
  const tee = await archiveTee(zgPub.decisions, deps())
  const r = await checkTee({ ...zgPub, tee }, deps())
  assert.equal(r.allTrue, true)
  assert.equal(r.signatures.length, zgPub.decisions.length)
  assert.deepEqual(r.quotes, { '0xprov': true })
})

test('archive tampering, unacknowledged signers, missing signatures and zero decisions all fail closed', async () => {
  const tee = await archiveTee(zgPub.decisions, deps())
  const t = structuredClone(tee); t.signatures[0].sig!.text = `${'c'.repeat(64)}:${'b'.repeat(64)}`
  assert.equal((await checkTee({ ...zgPub, tee: t }, deps())).signatures[0].verified, false)
  assert.equal((await checkTee({ ...zgPub, tee }, deps(svc({ teeSignerAcknowledged: false })))).allTrue, false)
  assert.equal((await checkTee({ ...zgPub, tee }, deps(svc({ teeSignerAddress: privateKeyToAccount(generatePrivateKey()).address })))).allTrue, false)
  const partial = await archiveTee(zgPub.decisions, deps(svc(), new Set(['k1'])))
  const r = await checkTee({ ...zgPub, tee: partial }, deps())
  assert.equal(r.allTrue, false)
  assert.match(r.signatures[1].reason, /404/)
  assert.equal((await checkTee({ ...zgPub, decisions: [] }, deps())).allTrue, false) // no vacuous "0/0 true"
  assert.equal((await checkTee(zgPub, deps())).allTrue, false) // no archive at all
})

test('a real archived E2EE-scheme signature (A2 probe, 2026-11-06) recovers to the on-chain signer; any edit fails', async () => {
  const ev = JSON.parse(readFileSync(new URL('../../../docs/evidence/faultline-a2-probe.json', import.meta.url), 'utf8'))
  const signer = '0xDdaEaac4d8525d72DfD20cc6dE0f28eb3d320Bfb' // mainnet InferenceServing.getService(0xf4FB8d2b…B250).teeSignerAddress
  assert.equal(signedScheme(ev.sig.text), 'e2ee-ct')
  assert.equal(await checkArchived(ev.sig, signer), true)
  assert.equal(await checkArchived({ ...ev.sig, text: ev.sig.text.replace('e2ee-ct', 'e2ee-cs') }, signer), false)
  assert.equal(await checkArchived({ ...ev.sig, text: ev.sig.text.replace(/.$/, '0') }, signer), false)
})

test('sealed check binds every public decision field to the hash-chained sealed log', async () => {
  const tenant = new Uint8Array(32).fill(7)
  const sealed = sealRun(sealedTar(dir), tenant, run.manifest.episode_id)
  const files: Record<string, Uint8Array> = { P: publicJson(run), S: sealed }
  const cfg = { rpcUrl: '', indexerUrl: '', sealedRoot: 'S', tenantKeyHex: '07'.repeat(32) }
  const tee = { readService: async () => svc() }
  const ok: any = await verify('P', cfg, { download: async (r) => files[r], tee })
  assert.equal(ok.sealed.publicDecisionsMatchSealed, true)
  assert.equal(ok.sealed.chainOk, true)
  const edited = JSON.parse(new TextDecoder().decode(files.P))
  edited.decisions[3].action = edited.decisions[3].action === 'BRAKE_HARD' ? 'MAINTAIN' : 'BRAKE_HARD'
  files.P = new TextEncoder().encode(JSON.stringify(edited))
  const bad: any = await verify('P', cfg, { download: async (r) => files[r], tee })
  assert.equal(bad.sealed.publicDecisionsMatchSealed, false)
})
