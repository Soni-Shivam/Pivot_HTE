// Independent verification of a published episode. No provider call is needed after publish: signatures are archived
// in the public JSON at publish time (they expire at the provider) and checked offline against the TEE signer that the
// 0G mainnet InferenceServing contract holds (audit A1). Downloads are refused unless their Merkle root matches (S1).
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { unpackTar } from '@sealedai/protocol'
import { openEpisode } from './key.ts'
import { checkOnchain } from './onchain.ts'
import { checkReplay } from './replay.ts'
import { storage } from '@sealedai/integrations'
import { chainOk, checkPublic } from './check.ts'
import { obsSha256, PUBLIC_FIELDS } from './bundle.ts'
import { checkTee, expectedSigner, fetchQuote, fetchSignature, readService, type Service, type SignatureEntry, type TeeArchive } from './tee.ts'
export { checkTee, type SignatureCheck, type TeeArchive } from './tee.ts'

export type TeeDeps = { readService: (provider: string) => Promise<Service>; fetchSignature: typeof fetchSignature; fetchQuote: typeof fetchQuote }
const liveDeps = (mainnetRpc?: string): TeeDeps => ({ readService: (p) => readService(p, mainnetRpc), fetchSignature, fetchQuote })

/** At publish time, while the provider still caches them: archive every 0G decision's {text, signature} and each
 *  provider's service record and TDX quote. A missing signature is recorded with its error, never invented. */
export async function archiveTee(decisions: any[], deps: TeeDeps = liveDeps()): Promise<TeeArchive> {
  const providers: TeeArchive['providers'] = {}
  const signatures: SignatureEntry[] = []
  for (const d of decisions) {
    if (d.source !== '0g' || !d.provider || !d.zg_res_key) { if (d.source === '0g') signatures.push({ cp: d.cp, zg_res_key: d.zg_res_key ?? null, sig: null, error: 'missing provider or Zg-Res-Key' }); continue }
    if (!providers[d.provider]) {
      const service = await deps.readService(d.provider)
      let quote: any = null, quote_error: string | undefined
      try { quote = await deps.fetchQuote(service) } catch (e) { quote_error = (e as Error).message }
      providers[d.provider] = { service, signer: expectedSigner(service), quote, ...(quote_error ? { quote_error } : {}) }
    }
    try { signatures.push({ cp: d.cp, zg_res_key: d.zg_res_key, sig: await deps.fetchSignature(providers[d.provider].service, d.zg_res_key) }) }
    catch (e) { signatures.push({ cp: d.cp, zg_res_key: d.zg_res_key, sig: null, error: (e as Error).message }) }
  }
  return { method: 'GET {service.url}/v1/proxy/signature/{Zg-Res-Key} at publish; EIP-191 signer vs InferenceServing.getService (0G mainnet)',
    captured_at: new Date().toISOString(), providers, signatures }
}

// Live re-check via the Compute SDK (kept for `faultline sigs`). Only meaningful while the provider still caches the
// signature (~20 min); for anything later use the archived check (checkTee).
export type ProcessResponse = (provider: string, chatId: string) => Promise<boolean | null>
export type Signature = { cp: number; request_id: string | null; provider: string | null; zg_res_key: string | null; source: string; verified: boolean | null }

export async function makeProcessResponse(mainnetRpc = 'https://evmrpc.0g.ai'): Promise<ProcessResponse> {
  const { createZGComputeNetworkBroker } = await import('@0gfoundation/0g-compute-ts-sdk')
  const { ethers } = await import('ethers')
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

export async function verify(publicRoot: string, cfg: VerifyConfig, deps: { download?: (root: string) => Promise<Uint8Array>; tee?: Pick<TeeDeps, 'readService'>
  onchain?: typeof checkOnchain } = {}) {
  const download = deps.download ?? storage({ rpcUrl: cfg.rpcUrl, indexerUrl: cfg.indexerUrl }).downloadBlob
  const pubBytes = await download(publicRoot) // throws unless the recomputed Merkle root equals publicRoot
  const pub = JSON.parse(new TextDecoder().decode(pubBytes))
  const c = checkPublic(pub)
  const tee = await checkTee(pub, deps.tee ?? liveDeps(cfg.mainnetRpc))
  const out: Record<string, unknown> = {
    publicRoot, publicRootOk: true, episode_id: pub.manifest.episode_id, status: pub.manifest.status,
    filesOk: c.filesOk, decisionsWellFormed: c.decisionsOk, metricsRecomputedOk: c.metricsRecomputedOk, aggregatesOk: c.aggregatesOk,
    signatures: tee.signatures, signaturesAllTrue: tee.allTrue, quoteSignerMatchesChain: tee.quotes,
    // A2 (docs/faultline-audit.md 2026-11-07): the signed hashes cover the Router↔enclave ciphertext, not our body
    contentBinding: 'not checkable: provider signs the sealed (E2EE) Router turn, see audit A2',
    onchain: await (deps.onchain ?? checkOnchain)(pub, publicRoot),
    replay: checkReplay(pub),
    checked_at: new Date().toISOString(),
  }
  if (cfg.sealedRoot && cfg.tenantKeyHex) {
    const blob = await download(cfg.sealedRoot)
    const { plaintext, keyVersion } = openEpisode(blob, hexToBytes(cfg.tenantKeyHex), pub.manifest.episode_id)
    const files = Object.fromEntries(unpackTar(plaintext).map((f) => [f.name, f.data]))
    const td = (n: string) => new TextDecoder().decode(files[n])
    const manifest = JSON.parse(td('manifest.json'))
    const lines = td('decisions.jsonl').split('\n').filter(Boolean)
    const sealedDecisions = lines.map((l) => JSON.parse(l))
    out.sealed = {
      sealedRoot: cfg.sealedRoot, opened: true, keyVersion,
      manifestMatchesPublic: JSON.stringify(manifest) === JSON.stringify(pub.manifest),
      filesHashesMatchManifest: Object.entries(manifest.files as Record<string, string>).every(([n, h]) => files[n] && bytesToHex(sha256(files[n])) === h),
      chainOk: chainOk(td('decisions.jsonl'), manifest.log_head),
      // every public decision field must equal the sealed, hash-chained line (audit R5: public fields were bound to nothing)
      publicDecisionsMatchSealed: lines.length === pub.decisions.length && sealedDecisions.every((s, i) =>
        PUBLIC_FIELDS.every((k) => JSON.stringify(s[k] ?? null) === JSON.stringify(pub.decisions[i][k] ?? null)) &&
        obsSha256(lines[i]) === pub.decisions[i].observation_sha256),
    }
  }
  return out
}
