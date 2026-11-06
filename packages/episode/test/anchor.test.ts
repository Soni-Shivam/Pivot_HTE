import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { resultCommitment, scenarioCommitment } from '../src/anchor.ts'
import { publicJson, readRun } from '../src/bundle.ts'

const SALT = ('0x' + '11'.repeat(32)) as `0x${string}`
const payload = new TextEncoder().encode('{"seed":42}')

test('scenarioCommitment = keccak256(abi.encode(bytes32 salt, bytes32 sha256(scenario.json)))', () => {
  const manual = '0x' + bytesToHex(keccak_256(new Uint8Array([...hexToBytes(SALT.slice(2)), ...nsha(payload)])))
  assert.equal(scenarioCommitment(payload, SALT), manual)
  assert.equal(resultCommitment(payload, SALT), manual) // same construction over metrics.json
  assert.notEqual(scenarioCommitment(payload, ('0x' + '12'.repeat(32)) as `0x${string}`), manual)
})

test('a run dir with anchor.json publishes no salt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fl-'))
  cpSync(new URL('./fixtures/run-kinematic', import.meta.url).pathname, dir, { recursive: true })
  writeFileSync(join(dir, 'anchor.json'), JSON.stringify({ salt: SALT, episodeId: '0x00' }))
  const s = new TextDecoder().decode(publicJson(readRun(dir)))
  assert.ok(!s.includes('salt') && !s.includes('11'.repeat(32)))
})
