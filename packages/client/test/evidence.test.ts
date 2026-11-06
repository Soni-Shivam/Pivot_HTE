import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { sha384 } from '@noble/hashes/sha2.js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { verifyQuote, verifyWorkerEvidence, verifyChallenge, challengeDigest, replayAndCheckRtmr3, EvidenceRejected } from '../src/evidence.ts'

const fx = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures/dcap', f))
const quote = new Uint8Array(fx('tdx_quote'))
const collateral = JSON.parse(fx('tdx_quote_collateral.json').toString())
// a time inside the sample collateral's validity window
const nowFor = (c: { tcb_info?: string }) => Math.floor(Date.parse(JSON.parse(c.tcb_info!).issueDate) / 1000) + 3600

test('realIntelTdxQuoteVerifies', async () => {
  const r = await verifyQuote(quote, { collateral, now: nowFor(collateral), allowedTcbStatus: ['UpToDate', 'SWHardeningNeeded', 'ConfigurationAndSWHardeningNeeded', 'OutOfDate'] })
  assert.ok(r.status)
  assert.equal(r.td.reportData.length, 64)
  assert.equal(r.td.rtMr3.length, 48)
})

test('tcbPolicyEnforced', async () => {
  const outdated = new Uint8Array(fx('tdx_quote_outdated'))
  const c = JSON.parse(fx('tdx_quote_outdated_collateral.json').toString())
  await assert.rejects(verifyQuote(outdated, { collateral: c, now: nowFor(c), allowedTcbStatus: ['UpToDate'] }), EvidenceRejected)
})

test('tamperedQuoteRejected', async () => {
  const bad = quote.slice()
  bad[700] ^= 0xff // inside the TD report body, covered by the QE signature
  await assert.rejects(verifyQuote(bad, { collateral, now: nowFor(collateral), allowedTcbStatus: ['UpToDate', 'OutOfDate', 'SWHardeningNeeded', 'ConfigurationAndSWHardeningNeeded'] }), EvidenceRejected)
})

const pk = generatePrivateKey()
const acct = privateKeyToAccount(pk)
const pub = acct.publicKey
const base = { workerAddress: acct.address, workerPubKey: pub, imageDigest: 'sha256:abc' }

test('noTeeIsAlwaysRejected', async () => {
  await assert.rejects(verifyWorkerEvidence({ runtime: 0, ...base, reason: 'dev server has no TDX' }, { nonce: '0x01', expectedImageDigest: 'sha256:abc', requireGpu: false }), /never released/)
})

test('unknownRuntimeRejected', async () => {
  await assert.rejects(verifyWorkerEvidence({ runtime: 3, ...base }, { nonce: '0x01', expectedImageDigest: 'x', requireGpu: false }), /no verifier/)
})

test('realQuoteWithForeignRuntimeDataRejected', async () => {
  const evidence = Buffer.from(JSON.stringify({ quote: Buffer.from(quote).toString('base64'), cc_eventlog: '', runtime_data: Buffer.from('{"nonce":"0x01","signer":"' + acct.address + '"}').toString('base64') })).toString('base64')
  await assert.rejects(
    verifyWorkerEvidence({ runtime: 2, ...base, tapp: { evidence } }, { nonce: '0x01', expectedImageDigest: 'sha256:abc', requireGpu: false, collateral, now: nowFor(collateral), allowedTcbStatus: ['UpToDate', 'OutOfDate', 'SWHardeningNeeded', 'ConfigurationAndSWHardeningNeeded'] }),
    /does not bind runtime_data/,
  )
})

test('challengeProvesKeyPossession', async () => {
  const nonce = '0x' + 'ab'.repeat(32) as `0x${string}`
  const sig = await acct.signMessage({ message: { raw: challengeDigest(nonce) } })
  await verifyChallenge({ runtime: 2, ...base }, nonce, sig)
  const other = privateKeyToAccount(generatePrivateKey())
  await assert.rejects(verifyChallenge({ runtime: 2, ...base }, nonce, await other.signMessage({ message: { raw: challengeDigest(nonce) } })), /challenge/)
})

/** Build a minimal TCG2 CC event log: SpecID header + EV_EVENT_TAG events on MR index 4. */
function eventLog(texts: string[]) {
  const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b }
  const parts: Uint8Array[] = [new Uint8Array(8 + 20), u32(0)]
  let rtmr = new Uint8Array(48)
  for (const t of texts) {
    const tb = new TextEncoder().encode(t)
    const data = new Uint8Array([...u32(0), ...u32(tb.length), ...tb])
    const digest = sha384(data)
    rtmr = sha384(new Uint8Array([...rtmr, ...digest]))
    parts.push(u32(4), u32(6), u32(1), new Uint8Array([0x0c, 0x00]), digest, u32(data.length), data)
  }
  const log = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) { log.set(p, o); o += p.length }
  return { log, rtmr }
}

test('eventLogReplayFindsStartApp', () => {
  const { log, rtmr } = eventLog(['tapp.0g.com start_app {"operation":"start_app","result":"success","image_hash":{"worker":"sha256:abc"}}'])
  const ev = replayAndCheckRtmr3(log, rtmr)
  assert.equal(ev[0].image_hash!.worker, 'sha256:abc')
})

test('forgedEventLogRejected', () => {
  const { log } = eventLog(['tapp.0g.com start_app {"operation":"start_app","result":"success","image_hash":{"worker":"sha256:evil"}}'])
  const { rtmr } = eventLog(['tapp.0g.com start_app {"operation":"start_app","result":"success","image_hash":{"worker":"sha256:abc"}}'])
  assert.throws(() => replayAndCheckRtmr3(log, rtmr), /does not replay/)
})

test('noAcceptAnywaySwitchInProductionCode', () => {
  const dir = join(import.meta.dirname, '..', 'src')
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8')
    assert.ok(!/insecure|skipVerif|allowUnattested|acceptAnyway|TEST_ONLY/i.test(src), `${f} must not contain a verification bypass (SECURITY I12)`)
  }
})
