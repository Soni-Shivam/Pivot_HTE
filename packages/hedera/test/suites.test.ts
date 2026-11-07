import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { DEMO_SWARM, demoSuite, requestHash, runnerArgs, startAllowed, suiteOf } from '../src/suites.ts'

const policy = `0x${'ab'.repeat(32)}`
const carlaJob = { suite: 'cut-in-v1-carla', simulator: 'carla-0.10.0-cut-in', policyCommitment: policy, status: 'accepted' }

test('allowlist maps each suite to its simulator and refuses anything else', () => {
  assert.deepEqual(suiteOf('cut-in-v1-kinematic'), { suite: 'cut-in-v1-kinematic', simulator: 'kinematic-cut-in' })
  for (const bad of ['cut-in-v1', 'toString', '__proto__', '', undefined]) assert.throws(() => suiteOf(bad), /unknown_suite/)
})

test('request hash binds suite and simulator (so payer signature and permit do too)', () => {
  const k = 'x'.repeat(16)
  assert.notEqual(requestHash('cut-in-v1-carla', policy, k), requestHash('cut-in-v1-kinematic', policy, k))
  assert.equal(requestHash('cut-in-v1-carla', policy.toUpperCase().replace('0X', '0x'), k), requestHash('cut-in-v1-carla', policy, k))
})

test('runner refuses a kinematic permit when asked to run CARLA, and vice versa', () => {
  const kinJob = { suite: 'cut-in-v1-kinematic', simulator: 'kinematic-cut-in' }
  assert.throws(() => runnerArgs('cut-in-v1-carla', kinJob), /Permit is for suite cut-in-v1-kinematic/)
  assert.throws(() => runnerArgs('cut-in-v1-kinematic', carlaJob), /Permit is for suite cut-in-v1-carla/)
  assert.throws(() => runnerArgs('cut-in-v1-carla', { suite: 'cut-in-v1-carla', simulator: 'kinematic-cut-in' }))
  assert.deepEqual(runnerArgs('cut-in-v1-carla', carlaJob).slice(0, 2), ['--world', 'carla'])
  assert.deepEqual(runnerArgs('cut-in-v1-kinematic', kinJob).slice(0, 2), ['--world', 'kinematic'])
})

test('server start needs the exact bought suite, simulator and policy, once', () => {
  const body = { suite: 'cut-in-v1-carla', simulator: 'carla-0.10.0-cut-in', policyCommitment: policy }
  assert.equal(startAllowed(carlaJob, body), true)
  assert.equal(startAllowed(carlaJob, { ...body, suite: 'cut-in-v1-kinematic' }), false)
  assert.equal(startAllowed(carlaJob, { ...body, simulator: 'kinematic-cut-in' }), false)
  assert.equal(startAllowed(carlaJob, { ...body, policyCommitment: `0x${'cd'.repeat(32)}` }), false)
  assert.equal(startAllowed({ ...carlaJob, status: 'completed' }, body), false)
  assert.equal(startAllowed({ ...carlaJob, suite: 'cut-in-v1', simulator: undefined }, { ...body, suite: 'cut-in-v1', simulator: undefined }), false)
})

test('demo suites: the four-car swarm is free-only, PDM-Lite only, on the CARLA lane; cut-in suites keep their lanes', () => {
  assert.equal(DEMO_SWARM, 'swarm-v1-carla')
  assert.deepEqual(demoSuite('swarm-v1-carla', 'free', 'pdm-lite'), { lane: 'carla', swarm: true })
  assert.match((demoSuite('swarm-v1-carla', 'paid', 'pdm-lite') as { error: string }).error, /free/)
  assert.match((demoSuite('swarm-v1-carla', 'free', 'idm-cautious') as { error: string }).error, /PDM-Lite/)
  assert.deepEqual(demoSuite('cut-in-v1-kinematic', 'free', 'idm-cautious'), { lane: 'kin', swarm: false })
  assert.deepEqual(demoSuite('cut-in-v1-carla', 'paid', 'pdm-lite'), { lane: 'carla', swarm: false })
  for (const bad of ['nope', 'toString', undefined]) assert.ok('error' in demoSuite(bad, 'free', 'pdm-lite'))
})
