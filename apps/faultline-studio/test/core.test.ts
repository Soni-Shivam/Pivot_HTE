import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { PS_LIST, railHtml, statusChip, trustFromRun } from '../src/core/trust.ts'
import { isVerifyError, verifyRoot, type Run } from '../src/core/api.ts'
import { outcome, runTabs, runTitle } from '../src/core/run.ts'

const base: Run = { name: 'x', jobId: null, status: 'completed', world: 'carla', family: 'cut_in', decisions: 7, decisions0g: 7, ccs: 0.9, minTtc: 1.1, minGap: 3.5,
  collision: false, chain: null, storage: null, payment: null, episodeId: null, model: null }
const paid: Run = { ...base, name: 'paid-1',
  chain: { registry: '0xeE22', commitTx: '0x512e', finalizeTx: '0xf1', onchainMatches: true, committedBeforeFirstCall: true },
  storage: { publicRoot: '0xc121', sealedRoot: '0x47b9', signaturesArchived: 7, signatures0g: 7, signaturesVerified: 7 },
  payment: { transaction: '0.0.1@1.2', payer: '0.0.1', suite: 'cut-in-v1-carla', hashscan: 'https://hashscan.io/testnet/transaction/1' } }

test('statusChip shows an icon and a word for every status', () => {
  const words = PS_LIST.map((p) => statusChip(p).replace(/<[^>]+>/g, '').trim())
  assert.deepEqual(words, ['✓ Verified', '✗ Failed', '? Unavailable', '○ Not checked', '– Not applicable'])
  assert.match(statusChip('na'), /class="st na"/)
})

test('trustFromRun: free run is not paid, not anchored; paid run is', () => {
  const free = trustFromRun({ ...base, free: true }, [])
  assert.equal(free.free, true); assert.equal(free.hedera, null); assert.equal(free.commitTx, undefined)
  const fr = railHtml(free)
  assert.match(fr, /Free run: not paid, not anchored\./); assert.match(fr, /Free run, no payment/)
  const p = trustFromRun(paid, [])
  assert.equal(p.free, false); assert.equal(p.commitBeforeFirst, true); assert.equal(p.hedera?.transaction, '0.0.1@1.2'); assert.equal(p.publicRoot, '0xc121')
  // fail-closed: run metadata alone stays grey; only an independent check turns the chain dot green
  assert.match(railHtml(p), /dot meta"[^>]*><\/i>0G Galileo chain/)
  assert.match(railHtml({ ...p, checked: { sigs: null, storage: null, chain: true } }), /dot up"[^>]*><\/i>0G Galileo chain/)
  assert.doesNotMatch(railHtml(p), /not anchored/)
})

test('outcome sentence and run tabs follow the content rules', () => {
  assert.equal(outcome(base), 'Avoided collision in this test')
  assert.equal(outcome({ ...base, collision: true }), 'Collision occurred in this test')
  assert.equal(outcome(null), null)
  const t = runTabs('demo-free-carla-1/r7l__pdm', 'results')
  assert.match(t, /href="\/mission\/demo-free-carla-1\/r7l__pdm"/)
  assert.match(t, /href="\/results\/demo-free-carla-1\/r7l__pdm" aria-current="page"/)
  assert.match(t, /href="\/verify\/demo-free-carla-1\/r7l__pdm"/)
  assert.equal(runTitle('0123456789abcdef'), 'Your run 01234567')
})

test('verifyRoot maps the fixture and the error shapes', async () => {
  const fx = readFileSync(new URL('./fixtures/verify-002.json', import.meta.url), 'utf8')
  const reply = (status: number, body: string) => { globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch }
  reply(200, fx)
  const ok = await verifyRoot('0xc121')
  assert.ok(!isVerifyError(ok)); assert.equal(ok.publicRootOk, true)
  reply(422, JSON.stringify({ error: 'storage unreachable', rootMismatch: false }))
  assert.deepEqual(await verifyRoot('0x1'), { status: 422, error: 'storage unreachable', rootMismatch: false })
  reply(429, JSON.stringify({ error: 'slow down' }))
  assert.deepEqual(await verifyRoot('0x1'), { status: 429, error: 'slow down' })
  reply(500, 'oops')
  const e = await verifyRoot('0x1'); assert.ok(isVerifyError(e)); assert.equal(e.status, 503)
  globalThis.fetch = (async () => { throw new Error('offline') }) as typeof fetch
  assert.deepEqual(await verifyRoot('0x1'), { status: 503, error: 'offline' })
})
