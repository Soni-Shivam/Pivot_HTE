import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compareReplay, replayLeadBrake, round6 } from '../src/replay.ts'

const dir = new URL('./fixtures/run-kinematic/', import.meta.url).pathname
const read = (f: string) => readFileSync(dir + f, 'utf8')
const scenario = JSON.parse(read('scenario.json'))
const decisions = read('decisions.jsonl').trim().split('\n').map((l) => JSON.parse(l))
const published = read('trajectory.jsonl').trim().split('\n').map((l) => JSON.parse(l))

test('round6 matches Python round(x, 6), ties to even and signed zero included', () => {
  assert.equal(round6(0.0078125), 0.007812) // exact binary tie, 2 is even: Python round(0.0078125, 6) == 0.007812
  assert.equal(round6(0.0234375), 0.023438) // exact tie, 7 is odd -> up
  assert.equal(round6(-0.0078125), -0.007812)
  assert.ok(Object.is(round6(-0.0), -0) && Object.is(round6(-1e-9), -0))
  assert.equal(round6(19.9586124999), 19.958612)
})

test('browser replay of the kinematic fixture is bit-exact (every field, tolerance 0)', () => {
  const r = replayLeadBrake(scenario, decisions)
  const c = compareReplay(published, r.rows, true, decisions.length, r.decisionsUsed)
  assert.equal(c.firstMismatch, null)
  assert.equal(c.ok, true)
  assert.equal(r.rows.length, published.length)
})

test('an edited control decel or a missing decision breaks the replay', () => {
  const edited = decisions.map((d, i) => (i === 5 ? { ...d, control_decel_mps2: d.control_decel_mps2 + 0.25 } : d))
  const r = replayLeadBrake(scenario, edited)
  assert.equal(compareReplay(published, r.rows, true, decisions.length, r.decisionsUsed).ok, false)
  assert.throws(() => replayLeadBrake(scenario, decisions.slice(0, 3)))
})
