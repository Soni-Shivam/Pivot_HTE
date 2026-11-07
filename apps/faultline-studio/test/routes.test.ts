import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { FEATURED, href, isStaticApp, navFor, parse } from '../src/routes.ts'

test('PRD pages resolve without changing the address bar', () => {
  assert.deepEqual(parse('/'), { page: 'home', id: null, canonical: null })
  assert.deepEqual(parse('/lab'), { page: 'lab', id: null, canonical: null })
  assert.deepEqual(parse('/mission/swarm-carla-010'), { page: 'mission', id: 'swarm-carla-010', canonical: null })
  assert.deepEqual(parse('/results/demo-free-carla-1/r7l__pdm'), { page: 'results', id: 'demo-free-carla-1/r7l__pdm', canonical: null })
  assert.deepEqual(parse('/verify'), { page: 'verify', id: null, canonical: null })
  assert.deepEqual(parse(`/verify/${FEATURED}`), { page: 'verify', id: FEATURED, canonical: null })
  assert.deepEqual(parse('/library'), { page: 'library', id: null, canonical: null })
  assert.deepEqual(parse('/stack/extra'), { page: 'stack', id: null, canonical: null })
})
test('aliases, id-less run pages and unknown paths land on a real page with a canonical URL', () => {
  assert.deepEqual(parse('/run/x'), { page: 'mission', id: 'x', canonical: '/mission/x' })
  assert.deepEqual(parse('/proof/x'), { page: 'verify', id: 'x', canonical: '/verify/x' })
  assert.deepEqual(parse('/proof'), { page: 'verify', id: null, canonical: '/verify' })
  assert.deepEqual(parse('/runs'), { page: 'library', id: null, canonical: '/library' })
  assert.deepEqual(parse('/attacks'), { page: 'home', id: null, canonical: '/#scenarios' })
  assert.deepEqual(parse('/mission'), { page: 'library', id: null, canonical: '/library' })
  assert.deepEqual(parse('/results'), { page: 'library', id: null, canonical: '/library' })
  for (const bad of ['/toString', '/constructor/x', '/nope', '/__proto__']) assert.deepEqual(parse(bad), { page: 'home', id: null, canonical: '/' })
  assert.equal(parse('/mission/%E0%A4%A').id, '%E0%A4%A') // malformed escape does not throw
})
test('href builders round-trip; static apps and nav grouping', () => {
  assert.equal(href.lab('swarm'), '/lab?attack=swarm')
  for (const id of [FEATURED, 'a/b']) { assert.equal(parse(href.mission(id)).id, id); assert.equal(parse(href.results(id)).id, id); assert.equal(parse(href.verify(id)).id, id) }
  assert.equal(href.verifier('0xab'), '/verifier/index.html?root=0xab')
  assert.ok(isStaticApp(href.verifier('0x1')) && isStaticApp(href.memory()) && !isStaticApp('/lab'))
  assert.equal(navFor('stack'), 'lab'); assert.equal(navFor('mission'), 'library'); assert.equal(navFor('results'), 'library'); assert.equal(navFor('verify'), 'verify')
})
