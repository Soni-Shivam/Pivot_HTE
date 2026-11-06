// Upload one run: the sealed tar (AES-256-GCM envelope, tenant key) and the public JSON, each to 0G Storage.
// The pre-publish signature check is embedded in the public JSON; `verify` re-checks independently.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hexToBytes } from '@noble/hashes/utils.js'
import { storage } from '@sealedai/integrations'
import { publicJson, readRun, sealedTar, sealRun } from './bundle.ts'
import { makeProcessResponse, verifySignatures, type ProcessResponse } from './verify.ts'

export type PublishConfig = { rpcUrl: string; indexerUrl: string; privateKey: string; tenantKeyHex: string; mainnetRpc?: string }

export async function publish(dir: string, cfg: PublishConfig, pr?: ProcessResponse) {
  const key = hexToBytes(cfg.tenantKeyHex)
  if (key.length !== 32) throw new Error('FAULTLINE_TENANT_KEY must be 32 bytes hex')
  const run = readRun(dir)
  const signatures = await verifySignatures(run.decisions, pr ?? (await makeProcessResponse(cfg.mainnetRpc)))
  const pub = publicJson(run, { method: 'processResponse(provider, Zg-Res-Key), Compute SDK 0.9.0, 0G mainnet', checked_at: new Date().toISOString(), signatures })
  const sealed = sealRun(sealedTar(dir), key, run.manifest.episode_id)
  writeFileSync(join(dir, 'sealed.bin'), sealed)
  writeFileSync(join(dir, 'public.json'), pub)
  const st = storage(cfg)
  const s = await st.uploadBlob(sealed)
  const p = await st.uploadBlob(pub)
  const out = { episode_id: run.manifest.episode_id, publicRoot: p.root, publicTx: p.txHash, sealedRoot: s.root, sealedTx: s.txHash,
    publicBytes: pub.length, sealedBytes: sealed.length, signatures_true: signatures.filter((x) => x.verified === true).length,
    signatures_0g: signatures.filter((x) => x.source === '0g').length }
  writeFileSync(join(dir, 'publish.json'), JSON.stringify(out, null, 2) + '\n')
  return out
}
