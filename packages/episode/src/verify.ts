// Independent verification of a published episode (plan Task 10). The one ethers import besides storage.ts: the
// Compute SDK needs an ethers wallet; a random throwaway one is enough for processResponse (spec §2.1).
import { createZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { open, unpackTar } from '@sealedai/protocol'
import { storage } from '@sealedai/integrations'
import { ethers } from 'ethers'
import { chainOk, checkPublic } from './check.ts'
import { obsSha256 } from './bundle.ts'

export type ProcessResponse = (provider: string, chatId: string) => Promise<boolean | null>
export type Signature = { cp: number; request_id: string | null; provider: string | null; zg_res_key: string | null; source: string; verified: boolean | null }

export async function makeProcessResponse(mainnetRpc = 'https://evmrpc.0g.ai'): Promise<ProcessResponse> {
  const wallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, new ethers.JsonRpcProvider(mainnetRpc))
  const broker = await createZGComputeNetworkBroker(wallet)
  return (p, k) => broker.inference.processResponse(p, k)
}

/** One processResponse per 0G decision; a thrown error is `null` (unknown), never `true`. */
export async function verifySignatures(decisions: any[], pr: ProcessResponse): Promise<Signature[]> {
  const out: Signature[] = []
  for (const d of decisions) {
    let verified: boolean | null = null
    if (d.source === '0g' && d.provider && d.zg_res_key) {
      try { verified = await pr(d.provider, d.zg_res_key) } catch { verified = null }
    }
    out.push({ cp: d.cp, request_id: d.request_id, provider: d.provider, zg_res_key: d.zg_res_key, source: d.source, verified })
  }
  return out
}

export type VerifyConfig = { rpcUrl: string; indexerUrl: string; mainnetRpc?: string; tenantKeyHex?: string; sealedRoot?: string }

export async function verify(publicRoot: string, cfg: VerifyConfig, deps: { download?: (root: string) => Promise<Uint8Array>; pr?: ProcessResponse } = {}) {
  const download = deps.download ?? storage({ rpcUrl: cfg.rpcUrl, indexerUrl: cfg.indexerUrl }).downloadBlob
  const pubBytes = await download(publicRoot) // downloadToBlob with proof: true
  const pub = JSON.parse(new TextDecoder().decode(pubBytes))
  const c = checkPublic(pub)
  const signatures = await verifySignatures(pub.decisions, deps.pr ?? (await makeProcessResponse(cfg.mainnetRpc)))
  const out: Record<string, unknown> = {
    publicRoot, publicRootOk: true, episode_id: pub.manifest.episode_id, status: pub.manifest.status,
    filesOk: c.filesOk, chainOk: c.decisionsOk, metricsRecomputedOk: c.metricsRecomputedOk,
    signatures, signaturesAllTrue: signatures.filter((s) => s.source === '0g').every((s) => s.verified === true),
    checked_at: new Date().toISOString(),
  }
  if (cfg.sealedRoot && cfg.tenantKeyHex) {
    const blob = await download(cfg.sealedRoot)
    const { plaintext } = open(blob, hexToBytes(cfg.tenantKeyHex), { objectType: 'episode', objectId: pub.manifest.episode_id })
    const files = Object.fromEntries(unpackTar(plaintext).map((f) => [f.name, f.data]))
    const td = (n: string) => new TextDecoder().decode(files[n])
    const manifest = JSON.parse(td('manifest.json'))
    const lines = td('decisions.jsonl').split('\n').filter(Boolean)
    out.sealed = {
      sealedRoot: cfg.sealedRoot, opened: true,
      manifestMatchesPublic: JSON.stringify(manifest) === JSON.stringify(pub.manifest),
      filesHashesMatchManifest: Object.entries(manifest.files as Record<string, string>).every(([n, h]) => files[n] && bytesToHex(sha256(files[n])) === h),
      chainOk: chainOk(td('decisions.jsonl'), manifest.log_head),
      observationsMatchPublic: lines.every((l, i) => obsSha256(l) === pub.decisions[i].observation_sha256),
    }
  }
  return out
}
