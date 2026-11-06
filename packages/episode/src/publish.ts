// Upload one run: the sealed tar (AES-256-GCM envelope, tenant key) and the public JSON, each to 0G Storage.
// Provider signatures, service records and TDX quotes are archived in the public JSON; `verify` re-checks offline.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hexToBytes } from '@noble/hashes/utils.js'
import { storage } from '@sealedai/integrations'
import { publicJson, readRun, revealOf, sealedTar, sealRun } from './bundle.ts'
import { archiveTee, type TeeDeps } from './verify.ts'

export type PublishConfig = { rpcUrl: string; indexerUrl: string; privateKey: string; tenantKeyHex: string; mainnetRpc?: string }

export async function publish(dir: string, cfg: PublishConfig, tee?: TeeDeps) {
  const key = hexToBytes(cfg.tenantKeyHex)
  if (key.length !== 32) throw new Error('FAULTLINE_TENANT_KEY must be 32 bytes hex')
  const run = readRun(dir)
  // Provider signatures live ~20 min in the broker's memory cache: archive them now (audit A1).
  const archive = await archiveTee(run.decisions, tee)
  const pub = publicJson(run, archive, revealOf(dir))
  const sealed = sealRun(sealedTar(dir), key, run.manifest.episode_id)
  writeFileSync(join(dir, 'sealed.bin'), sealed)
  writeFileSync(join(dir, 'public.json'), pub)
  const st = storage(cfg)
  const s = await st.uploadBlob(sealed)
  const p = await st.uploadBlob(pub)
  const out = { episode_id: run.manifest.episode_id, publicRoot: p.root, publicTx: p.txHash, publicTxSeq: p.txSeq, sealedRoot: s.root, sealedTx: s.txHash, sealedTxSeq: s.txSeq,
    sealedKey: 'hkdf-sha256(tenant key, "faultline/episode/v2:"+episode_id), envelope version 2',
    publicBytes: pub.length, sealedBytes: sealed.length, signatures_archived: archive.signatures.filter((x) => x.sig).length,
    signatures_0g: archive.signatures.length }
  writeFileSync(join(dir, 'publish.json'), JSON.stringify(out, null, 2) + '\n')
  return out
}
