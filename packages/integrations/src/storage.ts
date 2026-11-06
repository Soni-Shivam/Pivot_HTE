// 0G Storage adapter. The ONLY module that imports ethers (pinned 6.13.1, required by the storage SDK).
// Uploads already-sealed envelopes (PROTOCOL §3); the SDK's own `encryption` option is never used (SECURITY I10).
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk'
import { ethers } from 'ethers'

export type StorageConfig = { rpcUrl: string; indexerUrl: string; privateKey?: string }

export function storage(cfg: StorageConfig) {
  const indexer = new Indexer(cfg.indexerUrl)
  return {
    async uploadBlob(blob: Uint8Array): Promise<{ root: string; txHash: string }> {
      if (!cfg.privateKey) throw new Error('uploading needs a signer key')
      const signer = new ethers.Wallet(cfg.privateKey, new ethers.JsonRpcProvider(cfg.rpcUrl))
      const [res, err] = await indexer.upload(new MemData(blob), cfg.rpcUrl, signer)
      if (err) throw err
      if ('txHash' in res) return { root: res.rootHash, txHash: res.txHash }
      return { root: res.rootHashes[0], txHash: res.txHashes[0] } // fragmented upload: first fragment (not used for envelopes <4 GB)
    },
    /** Downloads `root` and refuses the bytes unless their recomputed 0G Merkle root equals `root`. SDK 1.2.13 ignores
     *  `{proof: true}` (Downloader.js `// TODO: add proof check`), so the root check here is the integrity check.
     *  Tries the indexer's https `GET /file?root=` first (CORS *, works from a hosted page), then `downloadToBlob`. */
    async downloadBlob(root: string): Promise<Uint8Array> {
      let bytes: Uint8Array | null = null
      try {
        const r = await fetch(`${cfg.indexerUrl.replace(/\/$/, '')}/file?root=${root}`)
        if (r.ok) bytes = new Uint8Array(await r.arrayBuffer())
      } catch { /* fall through to the node download */ }
      if (!bytes) {
        let res: Awaited<ReturnType<Indexer['downloadToBlob']>>
        try {
          res = await indexer.downloadToBlob(root)
        } catch (e) {
          throw new Error(`0G download failed for ${root}: ${(e as Error).message}`)
        }
        const [blob, err] = res
        if (err) throw err
        bytes = new Uint8Array(await blob!.arrayBuffer())
      }
      const got = await merkleRoot(bytes)
      if (got.toLowerCase() !== root.toLowerCase()) throw new Error(`0G download for ${root} has Merkle root ${got}: refused`)
      return bytes
    },
  }
}

/** 0G Storage Merkle root of raw bytes (the same tree the uploader submits on chain). */
export async function merkleRoot(bytes: Uint8Array): Promise<string> {
  const [tree, err] = await new MemData(bytes).merkleTree()
  if (err || !tree) throw err ?? new Error('could not build the Merkle tree')
  const root = tree.rootHash()
  if (!root) throw new Error('empty Merkle tree')
  return root
}
