// Proves: a payload uploaded to 0G Storage can be downloaded with Merkle proof verification and is byte-identical.
import 'dotenv/config'
import assert from 'node:assert'
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk'
import { ethers } from 'ethers'

const { RPC_URL, STORAGE_INDEXER, PRIVATE_KEY } = process.env
const signer = new ethers.Wallet(PRIVATE_KEY!, new ethers.JsonRpcProvider(RPC_URL))
const indexer = new Indexer(STORAGE_INDEXER!)

const payload = new TextEncoder().encode(`hello 0G ${new Date().toISOString()}`)
const [tx, upErr] = await indexer.upload(new MemData(payload), RPC_URL!, signer)
if (upErr) throw upErr
// SDK returns { txHash, rootHash } for single files (txHashes/rootHashes for fragmented ones)
const { rootHash, txHash } = tx as { rootHash: string; txHash: string }
console.log('root hash:', rootHash, '\ntx hash:  ', txHash)

const [blob, dlErr] = await indexer.downloadToBlob(rootHash, { proof: true })
if (dlErr) throw dlErr
assert.deepStrictEqual(new Uint8Array(await blob.arrayBuffer()), payload)
console.log('OK: downloaded with proof verification, bytes match')
