// Local keystore for per-object keys (PLAN §3.4, review R08). Random master key, never derived from a wallet
// signature. Recovery = a file encrypted under scrypt(passphrase); restoring needs nothing from us.
import { writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { gcm } from '@noble/ciphers/aes.js'
import { scrypt } from '@noble/hashes/scrypt.js'
import { bytesToHex, hexToBytes, randomBytes, concatBytes } from '@noble/hashes/utils.js'
import { seal, open, canonical } from '@sealedai/protocol'

const RECOVERY_SCHEMA = 'sealedai.recovery/v1'
type KdfParams = { N: number; r: number; p: number }
const DEFAULT_KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1 }

export class Vault {
  private constructor(private masterKey: Uint8Array, private keys: Map<string, Uint8Array>) {}

  static create() {
    return new Vault(randomBytes(32), new Map())
  }

  put(objectId: string, key: Uint8Array) {
    if (key.length !== 32) throw new Error('object keys are 32 bytes')
    this.keys.set(objectId, key)
  }

  get(objectId: string) {
    const k = this.keys.get(objectId)
    if (!k) throw new Error(`no key for ${objectId}`)
    return k
  }

  private body() {
    return canonical({ keys: Object.fromEntries([...this.keys].map(([id, k]) => [id, bytesToHex(k)])) })
  }

  private static fromBody(masterKey: Uint8Array, body: Uint8Array) {
    const { keys } = JSON.parse(new TextDecoder().decode(body)) as { keys: Record<string, string> }
    return new Vault(masterKey, new Map(Object.entries(keys).map(([id, h]) => [id, hexToBytes(h)])))
  }

  save(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const write = (f: string, b: Uint8Array) => {
      writeFileSync(join(dir, f), b, { mode: 0o600 })
      chmodSync(join(dir, f), 0o600)
    }
    write('master.key', this.masterKey)
    write('vault.bin', seal(this.body(), { objectType: 'vault', objectId: 'vault', version: 1 }, this.masterKey).blob)
  }

  static load(dir: string) {
    const masterKey = new Uint8Array(readFileSync(join(dir, 'master.key')))
    const { plaintext } = open(new Uint8Array(readFileSync(join(dir, 'vault.bin'))), masterKey, { objectType: 'vault', objectId: 'vault' })
    return Vault.fromBody(masterKey, plaintext)
  }

  // file = u32be(len(header)) || header || nonce(12) || GCM(scrypt(pass, salt), nonce, {masterKey, keys}, aad = header)
  exportRecovery(passphrase: string, kdf: Partial<KdfParams> = {}) {
    if (!passphrase) throw new Error('a non-empty passphrase is required')
    const params = { ...DEFAULT_KDF, ...kdf }
    const salt = randomBytes(16)
    const header = canonical({ schema: RECOVERY_SCHEMA, kdf: 'scrypt', ...params, salt: bytesToHex(salt) })
    const kek = scrypt(passphrase, salt, { ...params, dkLen: 32 })
    const nonce = randomBytes(12)
    const pt = canonical({ masterKey: bytesToHex(this.masterKey), body: new TextDecoder().decode(this.body()) })
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, header.length)
    return concatBytes(len, header, nonce, gcm(kek, nonce, header).encrypt(pt))
  }

  static importRecovery(file: Uint8Array, passphrase: string) {
    const hlen = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(0)
    const header = file.subarray(4, 4 + hlen)
    const h = JSON.parse(new TextDecoder().decode(header)) as KdfParams & { schema: string; kdf: string; salt: string }
    if (h.schema !== RECOVERY_SCHEMA || h.kdf !== 'scrypt') throw new Error('not a recovery file')
    const kek = scrypt(passphrase, hexToBytes(h.salt), { N: h.N, r: h.r, p: h.p, dkLen: 32 })
    const nonce = file.subarray(4 + hlen, 16 + hlen)
    const pt = gcm(kek, nonce, header).decrypt(file.subarray(16 + hlen)) // throws on wrong passphrase or tamper
    const { masterKey, body } = JSON.parse(new TextDecoder().decode(pt)) as { masterKey: string; body: string }
    return Vault.fromBody(hexToBytes(masterKey), new TextEncoder().encode(body))
  }
}
