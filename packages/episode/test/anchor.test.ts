import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256 as nsha } from '@noble/hashes/sha2.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { configHash, resultCommitment, scenarioCommitment } from '../src/anchor.ts'
import { publicJson, readRun, revealOf } from '../src/bundle.ts'
import { revealCommitments } from '../src/onchain.ts'

const SALT = ('0x' + '11'.repeat(32)) as `0x${string}`
const payload = new TextEncoder().encode('{"seed":42}')

test('scenarioCommitment = keccak256(abi.encode(bytes32 salt, bytes32 sha256(scenario.json)))', () => {
  const manual = '0x' + bytesToHex(keccak_256(new Uint8Array([...hexToBytes(SALT.slice(2)), ...nsha(payload)])))
  assert.equal(scenarioCommitment(payload, SALT), manual)
  assert.equal(resultCommitment(payload, SALT), manual) // same construction over metrics.json
  assert.notEqual(scenarioCommitment(payload, ('0x' + '12'.repeat(32)) as `0x${string}`), manual)
})

test('an anchored run reveals exactly scenario.json and the salt; both commitments recompute from the public JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fl-'))
  cpSync(new URL('./fixtures/run-kinematic', import.meta.url).pathname, dir, { recursive: true })
  writeFileSync(join(dir, 'anchor.json'), JSON.stringify({ salt: SALT, episodeId: '0x00', commitTx: '0xsecretish' }))
  const pub = JSON.parse(new TextDecoder().decode(publicJson(readRun(dir), undefined, revealOf(dir))))
  assert.deepEqual(Object.keys(pub.reveal).sort(), ['salt', 'scenario_json'])
  assert.equal(pub.reveal.salt, SALT)
  assert.equal(pub.reveal.scenario_json, readFileSync(join(dir, 'scenario.json'), 'utf8'))
  const rc = revealCommitments(pub)!
  assert.equal(rc.scenarioFileOk, true)
  assert.equal(rc.scenarioCommitment, scenarioCommitment(readFileSync(join(dir, 'scenario.json')), SALT))
  assert.equal(rc.resultCommitment, resultCommitment(readFileSync(join(dir, 'metrics.json')), SALT))
  assert.equal(revealCommitments({ ...pub, reveal: { ...pub.reveal, scenario_json: pub.reveal.scenario_json.replace('42', '43') } })!.scenarioFileOk, false)
  assert.equal(revealOf(new URL('./fixtures/run-kinematic', import.meta.url).pathname), undefined) // unanchored: nothing
})

test('configHash = keccak256(abi.encode(bytes32 prompt_hash, string model, string git_commit))', () => {
  const c = { prompt_hash: 'ab'.repeat(32), model: '0gm-1.0-35b-a3b', git_commit: 'c'.repeat(40) }
  assert.equal(configHash(c), keccak256(encodeAbiParameters(parseAbiParameters('bytes32, string, string'), [`0x${c.prompt_hash}`, c.model, c.git_commit])))
  assert.notEqual(configHash({ ...c, model: 'other' }), configHash(c))
})
