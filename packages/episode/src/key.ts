// Per-episode sealing key (audit R12). Browser-safe. The envelope header's `version` names the key derivation, so old
// bundles stay openable: 1 = the tenant key itself (bundles up to cutin-001), 2 = HKDF-SHA256(ikm = tenant key,
// no salt, info = "faultline/episode/v2:" + episode_id, 32 bytes). Leaking one episode key opens only that episode.
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { open } from '../../protocol/src/envelope.ts'

export const EPISODE_KEY_VERSION = 2
export const episodeKey = (tenantKey: Uint8Array, episodeId: string) =>
  hkdf(sha256, tenantKey, undefined, utf8ToBytes(`faultline/episode/v2:${episodeId}`), 32)

/** The envelope header's version, read before decrypting (the header is the AEAD's AAD, so a forged one fails open). */
export function envelopeVersion(blob: Uint8Array): number {
  const hlen = new DataView(blob.buffer, blob.byteOffset, blob.byteLength).getUint32(0)
  return JSON.parse(new TextDecoder().decode(blob.subarray(4, 4 + hlen))).version
}

export function openEpisode(blob: Uint8Array, tenantKey: Uint8Array, episodeId: string) {
  const version = envelopeVersion(blob)
  if (version !== 1 && version !== 2) throw new Error(`unknown episode key version ${version}`)
  const key = version === 2 ? episodeKey(tenantKey, episodeId) : tenantKey
  return { ...open(blob, key, { objectType: 'episode', objectId: episodeId, version }), keyVersion: version }
}
