// Safety memory (offline): Merkle vector shared with tests/python/test_memory.py, claim recomputation on a fixture
// written by faultline/memory.py, seal/open, and the auditor verify against fake 0G downloads and a fake anchor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomBytes } from '@noble/hashes/utils.js'
import type { Hex } from 'viem'
import { checkClaim, claimsCoverRecords, linesRoot, merkleRoot, openSnapshot, sealSnapshot, splitLines, wilson } from '../src/core.ts'
import { verify } from '../src/node.ts'

const enc = new TextEncoder()
const fx = (f: string) => new Uint8Array(readFileSync(new URL(`./fixture/${f}`, import.meta.url)))

test('Merkle vector matches Python (raw bytes: 35.0 stays 35.0)', () => {
  const lines = ['{"a":35.0}', '{"b":1}', '{"c":[1,2]}'].map((s) => enc.encode(s))
  assert.equal(linesRoot(lines), '0xf2ab04ece48236d5d89bfafa6f81c3d6edf3282c303d6ad5f482d8cad032a41b')
  assert.equal(merkleRoot([]), '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.notEqual(linesRoot([enc.encode('{"a":35}')]), linesRoot([enc.encode('{"a":35.0}')]))
  assert.deepEqual(splitLines(enc.encode('a\nb\n\nc\n')).map((l) => new TextDecoder().decode(l)), ['a', 'b', 'c'])
})

test('claims and roots written by Python recompute in TS', () => {
  const pub = JSON.parse(new TextDecoder().decode(fx('public.json')))
  const lines = splitLines(fx('records.jsonl'))
  assert.equal(linesRoot(lines), pub.records_root)
  const claims = pub.claim_lines.map((l: string) => JSON.parse(l))
  for (const c of claims) assert.ok(checkClaim(c, lines).ok, JSON.stringify(checkClaim(c, lines).checks))
  assert.ok(claimsCoverRecords(claims, lines))
  assert.ok(!claimsCoverRecords(claims.slice(1), lines))
  assert.ok(!checkClaim({ ...claims[0], n_collisions: claims[0].n_collisions + 1 }, lines).ok)
  assert.deepEqual(wilson(0, 0), [0, 1])
})

test('auditor verify: ok, then tampering and a wrong key fail', async () => {
  const tenant = randomBytes(32)
  const pubBytes = fx('public.json')
  const pub = JSON.parse(new TextDecoder().decode(pubBytes))
  const files = (records: Uint8Array) => [{ name: 'snapshot.json', data: fx('snapshot.json') }, { name: 'records.jsonl', data: records }]
  const sealed = sealSnapshot(files(fx('records.jsonl')), tenant, pub.memory_version)
  assert.equal(new TextDecoder().decode(openSnapshot(sealed, tenant, pub.memory_version)['records.jsonl']), new TextDecoder().decode(fx('records.jsonl')))
  assert.throws(() => openSnapshot(sealed, randomBytes(32), pub.memory_version))
  assert.throws(() => openSnapshot(sealed, tenant, 'idm-follower@1.1#3'))
  const P = `0x${'11'.repeat(32)}` as Hex, S = `0x${'22'.repeat(32)}` as Hex
  const anchorOk = async () => ({ publicRoot: P, sealedRoot: S, prevRoot: pub.prev_snapshot_root as Hex, claimsRoot: pub.claims_root as Hex, owner: '0x01' as Hex })
  const env = { rpcUrl: 'x', indexerUrl: 'x', tenantKeyHex: Buffer.from(tenant).toString('hex') }
  const run = (blob: Uint8Array, getAnchor = anchorOk) => verify(P, S, env, { download: async (r) => (r === P ? pubBytes : blob), getAnchor })
  const v = await run(sealed)
  assert.ok(v.ok, JSON.stringify(v))
  assert.equal(v.claims.length, pub.claim_lines.length)
  const txt = new TextDecoder().decode(fx('records.jsonl')).replace('"safe":false', '"safe":true ')
  const t = await run(sealSnapshot(files(enc.encode(txt)), tenant, pub.memory_version))
  assert.ok(!t.ok && !t.recordsRootOk)
  const w = await run(sealed, async () => ({ ...(await anchorOk()), claimsRoot: P }))
  assert.ok(!w.ok && !w.onchain.claimsRoot)
})
