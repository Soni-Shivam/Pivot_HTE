import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from '@noble/hashes/utils.js'
import { Vault } from '../src/vault.ts'

const FAST = { N: 2 ** 10 } // tests only; production default is N = 2^17

test('putGet', () => {
  const v = Vault.create()
  const k = randomBytes(32)
  v.put('obj-1', k)
  assert.deepEqual(v.get('obj-1'), k)
  assert.throws(() => v.get('missing'), /no key/)
})

test('saveLoad0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-'))
  try {
    const v = Vault.create()
    const k = randomBytes(32)
    v.put('obj-1', k)
    v.save(dir)
    for (const f of readdirSync(dir)) assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600, f)
    assert.deepEqual(Vault.load(dir).get('obj-1'), k)
  } finally { rmSync(dir, { recursive: true }) }
})

test('recoveryFreshDevice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-'))
  const v = Vault.create()
  const k = randomBytes(32)
  v.put('model-7', k)
  v.save(dir)
  const file = v.exportRecovery('correct horse battery staple', FAST)
  rmSync(dir, { recursive: true }) // device lost
  const restored = Vault.importRecovery(file, 'correct horse battery staple')
  assert.deepEqual(restored.get('model-7'), k)
})

test('wrongPassphraseThrows', () => {
  const v = Vault.create()
  v.put('a', randomBytes(32))
  const file = v.exportRecovery('right passphrase', FAST)
  assert.throws(() => Vault.importRecovery(file, 'wrong passphrase'))
})

test('tamperedRecoveryParamsThrow', () => {
  const v = Vault.create()
  v.put('a', randomBytes(32))
  const file = v.exportRecovery('right passphrase', FAST)
  const s = new TextDecoder().decode(file)
  const i = s.indexOf('"r":8')
  file[i + 4] = '9'.charCodeAt(0) // header is AAD-bound
  assert.throws(() => Vault.importRecovery(file, 'right passphrase'))
})

test('emptyPassphraseRefused', () => {
  assert.throws(() => Vault.create().exportRecovery('', FAST), /passphrase/)
})

test('noSignatureDerivation', () => {
  const dir = join(import.meta.dirname, '..', 'src')
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8')
    assert.ok(!/signMessage|personal_sign|signTypedData/.test(src), `${f} must not derive keys from wallet signatures (SECURITY R08)`)
  }
})
