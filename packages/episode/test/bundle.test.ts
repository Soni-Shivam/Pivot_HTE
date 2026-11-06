import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { randomBytes } from '@noble/hashes/utils.js'
import { mkdtempSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open, seal, unpackTar } from '@sealedai/protocol'
import { episodeKey, openEpisode } from '../src/key.ts'
import { obsSha256, publicJson, readRun, sealedTar, sealRun } from '../src/bundle.ts'

const DIR = new URL('./fixtures/run-kinematic', import.meta.url).pathname
const run = readRun(DIR)
const keysDeep = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out) }
  return out
}

test('public json of an unanchored run carries no observations, history, content, scenario or salt', () => {
  const bytes = publicJson(run)
  const pub = JSON.parse(new TextDecoder().decode(bytes))
  const keys = keysDeep(pub)
  for (const k of ['observation', 'history', 'content', 'scenario', 'salt']) assert.ok(!keys.has(k), k)
  const s = new TextDecoder().decode(bytes)
  for (const k of ['initial_gap_m', '"history"', 'salt']) assert.ok(!s.includes(k), k)
  assert.equal(pub.decisions.length, 27)
  assert.equal(pub.manifest.episode_id, run.manifest.episode_id)
  assert.ok(pub.decisions.every((d: { observation_sha256: string }) => /^[0-9a-f]{64}$/.test(d.observation_sha256)))
})

test('observation hash matches the Python-side obs_sha256 (raw canonical bytes, no re-serialization)', () => {
  for (let i = 0; i < run.decisions.length; i++) assert.equal(obsSha256(run.decisionLines[i]), run.decisions[i].obs_sha256)
})

test('sealed tar round-trips with the per-episode key and fails with another key, episode or a flipped byte', () => {
  const key = randomBytes(32)
  const id = run.manifest.episode_id
  const blob = sealRun(sealedTar(DIR), key, id)
  const { plaintext, keyVersion } = openEpisode(blob, key, id)
  assert.equal(keyVersion, 2)
  const names = unpackTar(plaintext).map((f) => f.name)
  assert.ok(names.includes('manifest.json') && names.includes('decisions.jsonl') && names.includes('scenario.json'))
  assert.throws(() => open(blob, key)) // the tenant key itself no longer opens it
  assert.ok(open(blob, episodeKey(key, id)).plaintext.length > 0)
  assert.throws(() => openEpisode(blob, randomBytes(32), id))
  assert.throws(() => openEpisode(blob, key, 'f'.repeat(64)))
  const bad = blob.slice()
  bad[bad.length - 20] ^= 1
  assert.throws(() => openEpisode(bad, key, id))
  // bundles sealed before HKDF (envelope version 1, raw tenant key) still open
  const old = seal(sealedTar(DIR), { objectType: 'episode', objectId: id, version: 1 }, key).blob
  assert.equal(openEpisode(old, key, id).keyVersion, 1)
})

test('sealedTar packs only the allowlisted evidence files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fl-'))
  cpSync(DIR, dir, { recursive: true })
  for (const f of ['verification.json', 'screen.mp4', 'publish.json', 'notes.txt']) writeFileSync(join(dir, f), 'x')
  const names = unpackTar(sealedTar(dir)).map((f) => f.name).sort()
  assert.deepEqual(names, ['decisions.jsonl', 'manifest.json', 'metrics.json', 'scenario.json', 'trajectory.jsonl'])
})

// Tenant isolation on the real demo-002 bundle (runs/ is local, so this skips on a fresh clone).
const DEMO = new URL('../../../runs/demo-002/', import.meta.url).pathname
test('a second tenant key cannot open demo-002; its public JSON leaks no scenario, history or salt', { skip: !existsSync(DEMO + 'sealed.bin') }, () => {
  const blob = new Uint8Array(readFileSync(DEMO + 'sealed.bin'))
  assert.throws(() => open(blob, randomBytes(32)), /tag|invalid/i)
  const s = readFileSync(DEMO + 'public.json', 'utf8')
  const salt = JSON.parse(readFileSync(DEMO + 'anchor.json', 'utf8')).salt.slice(2)
  for (const k of ['initial_gap_m', '"history"', '"salt"', salt]) assert.ok(!s.includes(k), k.slice(0, 20))
})
