// End-to-end request channel to the worker (PROTOCOL §6, SECURITY I8). Every request is ECIES-encrypted to the
// attested worker key and signed by the sender's wallet; every reply is ECIES-encrypted to a key the sender chose.
// Proxies, hosts and TLS terminators only ever see ciphertext.
import { encrypt, decrypt } from 'eciesjs'
import { keccak256, recoverMessageAddress, bytesToHex, hexToBytes, concatHex, stringToHex, type Address, type Hex } from 'viem'
import { randomBytes } from '@noble/hashes/utils.js'
import { canonical } from './canonical.ts'

export type MessageSigner = { address: Address; signMessage(a: { message: { raw: Hex } }): Promise<Hex> }
export const MAX_SKEW_SEC = 120

/** JSON with bigints as decimal strings (canonical JSON has no bigint). */
export const jsonSafe = (v: unknown): unknown =>
  typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(jsonSafe) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)])) : v

const strip0x = (h: string) => (h.startsWith('0x') ? h.slice(2) : h)

export async function sealRequest(workerPubKey: Hex, path: string, payload: unknown, signer: MessageSigner, replyTo: Hex): Promise<Uint8Array> {
  const inner = { path, payload: jsonSafe(payload), ts: Math.floor(Date.now() / 1000), nonce: bytesToHex(randomBytes(16)), replyTo, from: signer.address }
  const sig = await signer.signMessage({ message: { raw: keccak256(canonical(inner)) } })
  return encrypt(strip0x(workerPubKey), canonical({ ...inner, sig }))
}

export type OpenedRequest = { from: Address; payload: Record<string, unknown>; replyTo: Hex }

export async function openRequest(workerPrivKey: Hex, body: Uint8Array, path: string, seenNonces: Set<string>, now = Math.floor(Date.now() / 1000)): Promise<OpenedRequest> {
  let msg: { path: string; payload: Record<string, unknown>; ts: number; nonce: string; replyTo: Hex; from: Address; sig: Hex }
  try {
    msg = JSON.parse(new TextDecoder().decode(decrypt(strip0x(workerPrivKey), body)))
  } catch {
    throw new ChannelError('request is not encrypted to this worker')
  }
  const { sig, ...inner } = msg
  if (inner.path !== path) throw new ChannelError('request was made for another endpoint')
  if (Math.abs(now - inner.ts) > MAX_SKEW_SEC) throw new ChannelError('request is stale')
  if (seenNonces.has(inner.nonce)) throw new ChannelError('replayed request')
  const signer = await recoverMessageAddress({ message: { raw: keccak256(canonical(inner)) }, signature: sig })
  if (signer.toLowerCase() !== inner.from.toLowerCase()) throw new ChannelError('bad request signature')
  seenNonces.add(inner.nonce)
  return { from: signer, payload: inner.payload, replyTo: inner.replyTo }
}

export const sealReply = (replyTo: Hex, body: unknown) => encrypt(strip0x(replyTo), canonical(jsonSafe(body)))
export const openReply = <T = unknown>(privKey: Hex, body: Uint8Array) => JSON.parse(new TextDecoder().decode(decrypt(strip0x(privKey), body))) as T

export class ChannelError extends Error {}
export { hexToBytes }

/** What a worker signs to prove it holds its key for a fresh nonce (/v1/challenge). */
export const challengeDigest = (nonce: Hex) => keccak256(concatHex([stringToHex('sealedai.challenge'), nonce]))
