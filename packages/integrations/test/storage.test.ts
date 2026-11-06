// downloadBlob must refuse bytes whose recomputed 0G Merkle root differs from the requested root (audit S1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { merkleRoot, storage } from '../src/storage.ts'

const bytes = new TextEncoder().encode(JSON.stringify({ schema: 'faultline.public/v1', n: 1 }))

function withFetch(body: Uint8Array, fn: () => Promise<void>) {
  const orig = globalThis.fetch
  globalThis.fetch = (async () => new Response(body as BodyInit)) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

test('merkleRoot is stable and changes on a one-bit edit', async () => {
  const a = await merkleRoot(bytes)
  assert.match(a, /^0x[0-9a-f]{64}$/)
  assert.equal(await merkleRoot(bytes.slice()), a)
  const t = bytes.slice(); t[3] ^= 1
  assert.notEqual(await merkleRoot(t), a)
})

test('downloadBlob accepts bytes matching the root and refuses tampered bytes', async () => {
  const root = await merkleRoot(bytes)
  const st = storage({ rpcUrl: 'http://127.0.0.1:1', indexerUrl: 'http://indexer.invalid' })
  await withFetch(bytes, async () => assert.deepEqual(await st.downloadBlob(root), bytes))
  const t = bytes.slice(); t[5] ^= 1
  await withFetch(t, async () => assert.rejects(st.downloadBlob(root), /refused/))
})
