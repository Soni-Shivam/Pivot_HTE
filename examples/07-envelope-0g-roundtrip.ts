// Proves (T06): a 3-chunk sealed object round-trips through real 0G Storage with Merkle proofs, and a truncated
// chunk fails closed. Uses our AES-GCM envelope, never the SDK's unauthenticated encryption.
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { sealChunked, openChunked } from '@sealedai/protocol'
import { storage } from '@sealedai/integrations'

const { RPC_URL, STORAGE_INDEXER, PRIVATE_KEY } = process.env
const st = storage({ rpcUrl: RPC_URL!, indexerUrl: STORAGE_INDEXER!, privateKey: PRIVATE_KEY })

const data = new Uint8Array(randomBytes(2_500_000))
const meta = { objectType: 'model', objectId: `probe-${Date.now()}`, version: 1 } as const
const s = sealChunked(data, meta, 1_000_000)

const roots: string[] = []
for (const [i, b] of [...s.blobs, s.manifestBlob].entries()) {
  const r = await st.uploadBlob(b)
  roots.push(r.root)
  console.log(`${i < s.blobs.length ? `chunk ${i}` : 'manifest'}: root=${r.root} tx=${r.txHash}`)
}
const blobs = await Promise.all(roots.slice(0, -1).map((r) => st.downloadBlob(r)))
const manifestBlob = await st.downloadBlob(roots.at(-1)!)
assert.deepEqual(openChunked(manifestBlob, blobs, s.key, meta), data)
console.log('OK: 3 chunks downloaded with proof, GCM-verified, reassembled, sha256 matches')

const truncated = [...blobs]
truncated[1] = truncated[1].slice(0, -1)
assert.throws(() => openChunked(manifestBlob, truncated, s.key, meta))
console.log('OK: truncated chunk rejected')
