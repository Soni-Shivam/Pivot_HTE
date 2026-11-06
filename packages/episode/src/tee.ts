// Archived 0G TeeML evidence (audit A1/B1). Browser-safe: viem only, no Node or ethers imports.
//
// Facts this follows (sources):
// - Provider signs text = hex(sha256(reqBody)) + ":" + hex(sha256(respBody)) with EIP-191 personal_sign
//   (0g-serving-broker api/inference/internal/ctrl/signing.go signChatWithKey, commit 56f24ba4). Sealed (E2EE) turns,
//   which is what the Router sends today (response header x-0g-e2ee: sealed, seen live 2026-11-06), are signed as
//   "zg-sig-v1/e2ee-ct:<reqH>:<respH>" over sha256(aad ‖ ciphertext) of the Router↔enclave envelopes
//   (broker docs/design/e2ee.md §"Response signature", signChatE2EE). Neither form binds the body we receive from the
//   Router (audit A2, docs/evidence/faultline-a2-probe.json); the signature proves the provider's TEE answered that chat.
// - The signature is cached in memory only (chatCacheExpiration, default 20 min, config.go), served at
//   GET {svc.url}/v1/proxy/signature/{chatID}?model={svc.model}; after expiry: 404 chat_id_not_found (seen live).
// - Signer = Service.teeSignerAddress, or additionalInfo.TargetTeeAddress for separated decentralized providers
//   (Compute SDK 0.9.0 ResponseProcessor.processResponse); service read from the mainnet InferenceServing contract
//   (SDK CONTRACT_ADDRESSES.mainnet.inference).
// - GET {svc.url}/v1/quote returns the TDX quote JSON; legacy report_data = ASCII signer address, zero padded
//   (broker common/tee/tee.go). Full quote verification is the dstack verifier's job and is not done here.
import { createPublicClient, http, parseAbi, recoverMessageAddress, type Hex } from 'viem'

export const INFERENCE_MAINNET = '0x47340d900bdFec2BD393c626E12ea0656F938d84' as const
export const MAINNET_RPC = 'https://evmrpc.0g.ai'
const abi = parseAbi([
  'struct Service { address provider; string serviceType; string url; uint256 inputPrice; uint256 outputPrice; uint256 updatedAt; string model; string verifiability; string additionalInfo; address teeSignerAddress; bool teeSignerAcknowledged; }',
  'function getService(address provider) view returns (Service service)',
])

export type Service = { provider: string; url: string; model: string; verifiability: string; additionalInfo: string
  teeSignerAddress: string; teeSignerAcknowledged: boolean }
export type ArchivedSignature = { text: string; signature: string; signing_address?: string; signing_algo?: string }

export async function readService(provider: string, rpc = MAINNET_RPC): Promise<Service> {
  const c = createPublicClient({ transport: http(rpc) })
  const s = await c.readContract({ address: INFERENCE_MAINNET, abi, functionName: 'getService', args: [provider as Hex] })
  return { provider: s.provider, url: s.url, model: s.model, verifiability: s.verifiability, additionalInfo: s.additionalInfo,
    teeSignerAddress: s.teeSignerAddress, teeSignerAcknowledged: s.teeSignerAcknowledged }
}

/** The address whose signature counts, or null when the SDK would answer false (same rules as processResponse). */
export function expectedSigner(s: Service): string | null {
  if (!/^tee/i.test(s.verifiability) || !s.teeSignerAcknowledged || !s.additionalInfo) return null
  let info: any
  try { info = JSON.parse(s.additionalInfo) } catch { return null }
  const centralized = info.ProviderType === 'centralized'
  return info.TargetSeparated === true && !centralized && info.TargetTeeAddress ? info.TargetTeeAddress : s.teeSignerAddress
}

/** Fetch the provider's signature for one chat while it is still cached. Throws on any non-200. */
export async function fetchSignature(s: Service, chatId: string): Promise<ArchivedSignature> {
  const r = await fetch(`${s.url.replace(/\/$/, '')}/v1/proxy/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(s.model)}`)
  if (!r.ok) throw new Error(`signature for ${chatId}: HTTP ${r.status}`)
  const j = await r.json()
  if (typeof j?.text !== 'string' || typeof j?.signature !== 'string') throw new Error(`signature for ${chatId}: bad body`)
  return { text: j.text, signature: j.signature, signing_address: j.signing_address, signing_algo: j.signing_algo }
}

export const SIGNED_TEXT = /^(zg-sig-v1\/e2ee-ct:)?[0-9a-f]{64}:[0-9a-f]{64}$/
/** 'e2ee-ct' (hashes over the Router↔enclave ciphertext) or 'plaintext'. */
export const signedScheme = (text: string) => (text.startsWith('zg-sig-v1/e2ee-ct:') ? 'e2ee-ct' : 'plaintext')

/** Offline check of an archived signature: well-formed text and EIP-191 signer equals `signer`. Never throws. */
export async function checkArchived(sig: ArchivedSignature | null | undefined, signer: string | null): Promise<boolean> {
  if (!sig || !signer || !SIGNED_TEXT.test(sig.text) || !/^0x[0-9a-fA-F]{130}$/.test(sig.signature)) return false
  try {
    const got = await recoverMessageAddress({ message: sig.text, signature: sig.signature as Hex })
    return got.toLowerCase() === signer.toLowerCase()
  } catch { return false }
}

/** The signer address carried in a TDX quote's legacy report_data (base64 of the ASCII address, zero padded). */
export function reportDataSigner(reportDataB64: string): string | null {
  try {
    const ascii = atob(reportDataB64).replace(/\0+$/, '')
    return /^0x[0-9a-fA-F]{40}$/.test(ascii) ? ascii : null
  } catch { return null }
}

export async function fetchQuote(s: Service): Promise<any> {
  const r = await fetch(`${s.url.replace(/\/$/, '')}/v1/quote`)
  if (!r.ok) throw new Error(`quote: HTTP ${r.status}`)
  return JSON.parse(await r.text())
}

export type SignatureEntry = { cp: number; zg_res_key: string | null; sig: ArchivedSignature | null; error?: string }
export type TeeArchive = { method: string; captured_at: string
  providers: Record<string, { service: Service; signer: string | null; quote: any; quote_error?: string }>
  signatures: SignatureEntry[] }


export type SignatureCheck = { cp: number; provider: string | null; verified: boolean; reason: string; scheme?: string }

/** Re-check archived signatures. The signer comes from the chain (deps.readService), never from the archive. */
export async function checkTee(pub: any, deps: { readService: (provider: string) => Promise<Service> }): Promise<{ signatures: SignatureCheck[]; allTrue: boolean; quotes: Record<string, boolean> }> {
  const zg = (pub.decisions as any[]).filter((d) => d.source === '0g')
  const arch: TeeArchive | undefined = pub.tee
  const signers: Record<string, string | null> = {}
  const out: SignatureCheck[] = []
  for (const d of zg) {
    if (!(d.provider in signers)) {
      try { signers[d.provider] = expectedSigner(await deps.readService(d.provider)) } catch { signers[d.provider] = null }
    }
    const e = arch?.signatures.find((s) => s.cp === d.cp && s.zg_res_key === d.zg_res_key)
    const ok = await checkArchived(e?.sig, signers[d.provider])
    out.push({ cp: d.cp, provider: d.provider, verified: ok, ...(e?.sig ? { scheme: signedScheme(e.sig.text) } : {}),
      reason: ok ? 'signer matches chain' : !e?.sig ? (e?.error ?? 'no archived signature') : !signers[d.provider] ? 'provider not TEE-acknowledged on chain' : 'bad signature or signer' })
  }
  const quotes: Record<string, boolean> = {}
  for (const [p, v] of Object.entries(arch?.providers ?? {})) {
    const rd = v.quote?.report_data
    quotes[p] = typeof rd === 'string' && !!signers[p] && reportDataSigner(rd)?.toLowerCase() === signers[p]!.toLowerCase()
  }
  return { signatures: out, allTrue: zg.length > 0 && out.every((s) => s.verified), quotes }
}

