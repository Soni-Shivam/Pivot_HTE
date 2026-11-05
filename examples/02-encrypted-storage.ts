// Proves: SDK client-side AES-256 encryption - only the right key recovers plaintext; a wrong key silently yields ciphertext.
import 'dotenv/config'
import assert from 'node:assert'
import { createHash, randomBytes } from 'node:crypto'
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk'
import { ethers } from 'ethers'

const { RPC_URL, STORAGE_INDEXER, PRIVATE_KEY } = process.env
const signer = new ethers.Wallet(PRIVATE_KEY!, new ethers.JsonRpcProvider(RPC_URL))
const indexer = new Indexer(STORAGE_INDEXER!)
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

const plaintext = new TextEncoder().encode('secret training dataset row 1,2,3')
const key = new Uint8Array(randomBytes(32))
const [tx, upErr] = await indexer.upload(new MemData(plaintext), RPC_URL!, signer, { encryption: { type: 'aes256', key } })
if (upErr) throw upErr
const { rootHash, txHash } = tx as { rootHash: string; txHash: string }
console.log('root hash:', rootHash, '\ntx hash:  ', txHash)

const fetchWith = async (k: Uint8Array) => {
  const [blob, err] = await indexer.downloadToBlob(rootHash, { proof: true, decryption: { symmetricKey: k } })
  if (err) throw err
  return new Uint8Array(await blob.arrayBuffer())
}
assert.equal(sha(await fetchWith(key)), sha(plaintext))
console.log('correct key -> plaintext matches')

// Wrong key does not throw; it returns garbage, so compare hashes.
const bad = await fetchWith(new Uint8Array(randomBytes(32)))
assert.notEqual(sha(bad), sha(plaintext))
console.log(`wrong key   -> NOT plaintext (${bad.length} bytes of ciphertext/garbage)`)
