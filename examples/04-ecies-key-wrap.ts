// Proves: a data key can be wrapped to an enclave's secp256k1 public key (ECIES) and only that private key unwraps it.
import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { PrivateKey, encrypt, decrypt } from 'eciesjs'

const enclave = new PrivateKey()
const dataKey = randomBytes(32)
const wrapped = encrypt(enclave.publicKey.toHex(), dataKey)
console.log('enclave pubkey:', enclave.publicKey.toHex(), `\nwrapped key: ${wrapped.length} bytes`)

assert.deepStrictEqual(Buffer.from(decrypt(enclave.secret, wrapped)), dataKey)
console.log('OK: enclave private key unwraps the data key')

assert.throws(() => decrypt(new PrivateKey().secret, wrapped))
console.log('OK: a different keypair fails to unwrap')
