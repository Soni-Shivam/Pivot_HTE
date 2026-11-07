import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { FEATURED, href, parse } from '../src/routes.ts'

test('pages resolve without changing the address bar', () => {
  assert.deepEqual(parse('/'), { page: 'home', id: null, canonical: null })
  assert.deepEqual(parse('/lab'), { page: 'lab', id: null, canonical: null })
  assert.deepEqual(parse('/run/swarm-carla-010'), { page: 'run', id: 'swarm-carla-010', canonical: null })
  assert.deepEqual(parse('/run/demo-free-carla-1/r7l__pdm'), { page: 'run', id: 'demo-free-carla-1/r7l__pdm', canonical: null })
  assert.deepEqual(parse('/proof'), { page: 'proof', id: null, canonical: null })
})
test('old paths and unknown paths land on the new page with a canonical URL', () => {
  assert.deepEqual(parse(`/mission/${FEATURED}`), { page: 'run', id: FEATURED, canonical: `/run/${FEATURED}` })
  assert.deepEqual(parse('/results/x'), { page: 'run', id: 'x', canonical: '/run/x' })
  assert.deepEqual(parse('/verify/x'), { page: 'proof', id: 'x', canonical: '/proof/x' })
  assert.deepEqual(parse('/verify'), { page: 'proof', id: null, canonical: '/proof' })
  assert.deepEqual(parse('/library'), { page: 'runs', id: null, canonical: '/runs' })
  assert.deepEqual(parse('/run'), { page: 'runs', id: null, canonical: '/runs' })
  for (const bad of ['/toString', '/constructor/x', '/nope']) assert.deepEqual(parse(bad), { page: 'home', id: null, canonical: '/' })
  assert.equal(parse('/run/%E0%A4%A').id, '%E0%A4%A') // malformed escape does not throw
})
test('href builders round-trip through parse', () => {
  assert.equal(href.lab('swarm'), '/lab?attack=swarm')
  assert.equal(href.run('demo-free-carla-1/r7l__pdm'), '/run/demo-free-carla-1/r7l__pdm')
  for (const id of [FEATURED, 'a/b']) assert.equal(parse(href.run(id)).id, id)
})
