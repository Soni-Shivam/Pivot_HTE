import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from '@noble/hashes/utils.js'
import { seal, open, sealChunked, openChunked, canonical } from '../src/index.ts'

const meta = { objectType: 'dataset', objectId: 'ds-1', version: 1 } as const
const pt = new TextEncoder().encode('{"text":"hello","label":"a"}')

test('roundTrip', () => {
  const { blob, key, header } = seal(pt, meta)
  const out = open(blob, key)
  assert.deepEqual(out.plaintext, pt)
  assert.deepEqual(out.header, header)
  assert.equal(header.size, pt.length)
})

test('wrongKeyThrows', () => {
  const { blob } = seal(pt, meta)
  assert.throws(() => open(blob, randomBytes(32)))
})

test('flippedBitThrows', () => {
  const { blob, key } = seal(pt, meta)
  blob[blob.length - 20] ^= 1
  assert.throws(() => open(blob, key))
})

test('modifiedHeaderThrows', () => {
  const { blob, key } = seal(pt, meta)
  const s = new TextDecoder().decode(blob)
  const i = s.indexOf('"version":1')
  assert.ok(i > 0)
  blob[i + '"version":'.length] = '2'.charCodeAt(0)
  assert.throws(() => open(blob, key))
})

test('truncatedThrows', () => {
  const { blob, key } = seal(pt, meta)
  assert.throws(() => open(blob.slice(0, blob.length - 1), key))
  assert.throws(() => open(blob.slice(0, 3), key))
})

test('expectMismatchThrows', () => {
  const { blob, key } = seal(pt, meta)
  assert.throws(() => open(blob, key, { objectId: 'other' }), /expected objectId/)
})

test('freshNonceEachSeal', () => {
  const key = randomBytes(32)
  const a = seal(pt, meta, key).blob
  const b = seal(pt, meta, key).blob
  assert.notDeepEqual(a, b)
})

test('canonicalIsKeyOrderIndependent', () => {
  assert.deepEqual(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), canonical({ a: [2, { c: 4, d: 3 }], b: 1 }))
})

const big = randomBytes(2500)
const cmeta = { objectType: 'model', objectId: 'bundle-x', version: 3 } as const

test('chunkedRoundTrip3Chunks', () => {
  const s = sealChunked(big, cmeta, 1000)
  assert.equal(s.blobs.length, 3)
  assert.deepEqual(openChunked(s.manifestBlob, s.blobs, s.key, cmeta), big)
})

test('chunkReorderThrows', () => {
  const s = sealChunked(big, cmeta, 1000)
  assert.throws(() => openChunked(s.manifestBlob, [s.blobs[1], s.blobs[0], s.blobs[2]], s.key, cmeta))
})

test('missingChunkThrows', () => {
  const s = sealChunked(big, cmeta, 1000)
  assert.throws(() => openChunked(s.manifestBlob, s.blobs.slice(0, 2), s.key, cmeta), /chunk count/)
})

test('chunkFromOtherBundleThrows', () => {
  const s = sealChunked(big, cmeta, 1000)
  const t = sealChunked(big, { ...cmeta, objectId: 'bundle-y' }, 1000, s.key)
  assert.throws(() => openChunked(s.manifestBlob, [s.blobs[0], t.blobs[1], s.blobs[2]], s.key, cmeta))
})
