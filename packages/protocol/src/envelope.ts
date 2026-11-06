// Authenticated object envelope (PROTOCOL §3). Replaces the 0G Storage SDK's built-in `aes256` mode, which is
// AES-256-CTR without authentication: tampering would go unnoticed (SECURITY I10).
//   blob = u32be(len(header)) || header || nonce(12) || AES-256-GCM(key, nonce, plaintext, aad = header)
import { gcm } from '@noble/ciphers/aes.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, randomBytes } from '@noble/hashes/utils.js'
import { canonical } from './canonical.ts'

export type ObjectType = 'model' | 'dataset' | 'report' | 'timeline' | 'adapter' | 'vault' | 'episode'
export const ENVELOPE_SCHEMA = 'sealedai.obj/v1'
export type ObjectHeader = {
  schema: typeof ENVELOPE_SCHEMA
  objectType: ObjectType
  objectId: string
  version: number
  plaintextSha256: string
  size: number
}
export type ObjectMeta = { objectType: ObjectType; objectId: string; version: number }

const NONCE = 12
const TAG = 16

export function seal(plaintext: Uint8Array, meta: ObjectMeta, key: Uint8Array = randomBytes(32)) {
  if (key.length !== 32) throw new Error('key must be 32 bytes')
  const header: ObjectHeader = {
    schema: ENVELOPE_SCHEMA,
    objectType: meta.objectType,
    objectId: meta.objectId,
    version: meta.version,
    plaintextSha256: bytesToHex(sha256(plaintext)),
    size: plaintext.length,
  }
  const hb = canonical(header)
  const nonce = randomBytes(NONCE)
  const ct = gcm(key, nonce, hb).encrypt(plaintext)
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, hb.length)
  return { blob: concatBytes(len, hb, nonce, ct), key, header }
}

export function open(blob: Uint8Array, key: Uint8Array, expect: Partial<ObjectHeader> = {}) {
  if (key.length !== 32) throw new Error('key must be 32 bytes')
  if (blob.length < 4) throw new Error('envelope truncated')
  const hlen = new DataView(blob.buffer, blob.byteOffset, blob.byteLength).getUint32(0)
  if (blob.length < 4 + hlen + NONCE + TAG) throw new Error('envelope truncated')
  const hb = blob.subarray(4, 4 + hlen)
  const nonce = blob.subarray(4 + hlen, 4 + hlen + NONCE)
  const plaintext = gcm(key, nonce, hb).decrypt(blob.subarray(4 + hlen + NONCE)) // throws on bad tag
  const header = JSON.parse(new TextDecoder().decode(hb)) as ObjectHeader
  if (header.schema !== ENVELOPE_SCHEMA) throw new Error(`unknown envelope schema ${header.schema}`)
  if (header.size !== plaintext.length) throw new Error('size mismatch')
  if (header.plaintextSha256 !== bytesToHex(sha256(plaintext))) throw new Error('plaintext hash mismatch')
  for (const [k, v] of Object.entries(expect)) {
    if ((header as Record<string, unknown>)[k] !== v) throw new Error(`expected ${k}=${v}, got ${(header as Record<string, unknown>)[k]}`)
  }
  return { plaintext, header }
}

// Large objects (model bundles): one key, chunk i sealed as objectId `${id}#${i}`, plus a sealed chunk manifest
// that lists every chunk's hash and the whole-object hash. Reordered, missing or foreign chunks fail.
export type ChunkManifest = {
  objectId: string
  version: number
  totalSize: number
  sha256: string
  chunks: { objectId: string; plaintextSha256: string; size: number }[]
}

export function sealChunked(data: Uint8Array, meta: ObjectMeta, chunkSize = 64 * 2 ** 20, key: Uint8Array = randomBytes(32)) {
  const blobs: Uint8Array[] = []
  const chunks: ChunkManifest['chunks'] = []
  for (let off = 0, i = 0; off < data.length || i === 0; off += chunkSize, i++) {
    const s = seal(data.subarray(off, off + chunkSize), { ...meta, objectId: `${meta.objectId}#${i}` }, key)
    blobs.push(s.blob)
    chunks.push({ objectId: s.header.objectId, plaintextSha256: s.header.plaintextSha256, size: s.header.size })
  }
  const manifest: ChunkManifest = { objectId: meta.objectId, version: meta.version, totalSize: data.length, sha256: bytesToHex(sha256(data)), chunks }
  const m = seal(canonical(manifest), { ...meta, objectId: `${meta.objectId}#manifest` }, key)
  return { blobs, manifestBlob: m.blob, key, manifest }
}

export function openChunked(manifestBlob: Uint8Array, blobs: Uint8Array[], key: Uint8Array, meta: ObjectMeta) {
  const { plaintext } = open(manifestBlob, key, { objectType: meta.objectType, objectId: `${meta.objectId}#manifest`, version: meta.version })
  const manifest = JSON.parse(new TextDecoder().decode(plaintext)) as ChunkManifest
  if (manifest.objectId !== meta.objectId || manifest.version !== meta.version) throw new Error('manifest identity mismatch')
  if (blobs.length !== manifest.chunks.length) throw new Error(`chunk count ${blobs.length} != ${manifest.chunks.length}`)
  const parts = blobs.map((b, i) =>
    open(b, key, { objectType: meta.objectType, version: meta.version, objectId: manifest.chunks[i].objectId, plaintextSha256: manifest.chunks[i].plaintextSha256 }).plaintext,
  )
  const data = concatBytes(...parts)
  if (data.length !== manifest.totalSize || bytesToHex(sha256(data)) !== manifest.sha256) throw new Error('reassembled object hash mismatch')
  return data
}
