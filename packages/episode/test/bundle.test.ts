import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from '@noble/hashes/utils.js'
import { open, unpackTar } from '@sealedai/protocol'
import { obsSha256, publicJson, readRun, sealedTar, sealRun } from '../src/bundle.ts'

const DIR = new URL('./fixtures/run-kinematic', import.meta.url).pathname
const run = readRun(DIR)
const keysDeep = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out) }
  return out
}

test('public json carries no observations, history, content, scenario or salt', () => {
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

test('sealed tar round-trips with the right key and fails with another or a flipped byte', () => {
  const key = randomBytes(32)
  const blob = sealRun(sealedTar(DIR), key, run.manifest.episode_id)
  const { plaintext } = open(blob, key, { objectType: 'episode', objectId: run.manifest.episode_id })
  const names = unpackTar(plaintext).map((f) => f.name)
  assert.ok(names.includes('manifest.json') && names.includes('decisions.jsonl') && names.includes('scenario.json'))
  assert.throws(() => open(blob, randomBytes(32)))
  const bad = blob.slice()
  bad[bad.length - 20] ^= 1
  assert.throws(() => open(bad, key))
})
