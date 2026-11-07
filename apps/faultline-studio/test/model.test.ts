// Unit tests for the Studio's information architecture: scenario catalog, routes, run context.
// . ~/.nvm/nvm.sh && npx tsx --test apps/faultline-studio/test/model.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FEATURED, SCENARIOS, scenarioById, scenarioForRun, runPath, parseRoute, contextRun, navHrefs, runLabel } from '../src/model.ts'

test('routes', () => {
  assert.deepEqual(parseRoute('/scenario/swarm'), { page: 'scenario', id: 'swarm' })
  assert.deepEqual(parseRoute('/'), { page: 'home', id: '' })
  assert.equal(parseRoute('/library').page, 'home')
  assert.equal(parseRoute('/nope/x').page, 'home')
  assert.equal(parseRoute('/scenario/nope').page, 'home')
  assert.deepEqual(parseRoute('/lab'), { page: 'lab', id: '' })
  assert.deepEqual(parseRoute('/mission'), { page: 'mission', id: FEATURED })
})
test('run names with a slash round-trip', () => {
  const n = 'demo-free-carla-20261107T020922/r7l-2s3__pdm_lite'
  for (const p of ['mission', 'results', 'verify'] as const) assert.deepEqual(parseRoute(`/${p}/${runPath(n)}`), { page: p, id: n })
  assert.equal(navHrefs('a/b').mission, '/mission/a/b')
  assert.equal(navHrefs('a b').verify, '/verify/a%20b')
})
test('catalog', () => {
  assert.deepEqual(SCENARIOS.filter((s) => s.live).map((s) => s.id), ['cut-in'])
  assert.deepEqual(SCENARIOS.map((s) => s.id), ['cut-in', 'swarm', 'lead-brake', 'lidar-dropout', 'pedestrian', 'intersection'])
  assert.equal(scenarioById('swarm')?.title, 'Coordinated multi-vehicle attack')
  assert.equal(scenarioById('pedestrian')?.run, null)
})
test('scenario for a run', () => {
  assert.equal(scenarioForRun('swarm-carla-010')?.id, 'swarm')
  assert.equal(scenarioForRun(FEATURED)?.id, 'cut-in')
  assert.equal(scenarioForRun('demo-003')?.id, 'lead-brake')
  assert.equal(scenarioForRun('abc', 'cut_in')?.id, 'cut-in')
  assert.equal(scenarioForRun('abc', 'swarm_box')?.id, 'swarm')
  assert.equal(scenarioForRun('0123456789abcdef')?.id, 'cut-in') // live jobs are always the cut-in
  assert.equal(scenarioForRun('cutin-001', 'cut_in')?.id, 'cut-in')
  assert.equal(scenarioForRun('mystery'), undefined)
})
test('context run', () => {
  assert.equal(contextRun(null), FEATURED)
  assert.equal(contextRun(''), FEATURED)
  assert.equal(contextRun('swarm-carla-010'), 'swarm-carla-010')
})
test('labels', () => {
  assert.equal(runLabel(FEATURED), 'Paid test 002')
  assert.equal(runLabel('0123456789abcdef'), 'Your run 01234567')
  assert.equal(runLabel('swarm-carla-010'), 'swarm-carla-010')
})
