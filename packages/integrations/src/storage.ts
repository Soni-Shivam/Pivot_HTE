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
    async downloadBlob(root: string): Promise<Uint8Array> {
      let res: Awaited<ReturnType<Indexer['downloadToBlob']>>
      try {
        res = await indexer.downloadToBlob(root, { proof: true })
      } catch (e) {
        throw new Error(`0G download failed for ${root}: ${(e as Error).message}`)
      }
      const [blob, err] = res
      if (err) throw err
      return new Uint8Array(await blob!.arrayBuffer())
    },
  }
}
