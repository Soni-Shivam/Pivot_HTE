import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jsonlSignatures } from '../src/sigs.ts'

test('sigs runs processResponse on lines with provider and zg_res_key only', async () => {
  const lines = [
    { i: 0, provider: '0xp', zg_res_key: 'k0', request_id: 'r0' },
    { i: 1, provider: null, zg_res_key: null, request_id: null },
    { i: 2, provider: '0xp', zg_res_key: 'k2', request_id: 'r2' },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n'
  const seen: string[] = []
  const r = await jsonlSignatures(lines, async (p, k) => { seen.push(`${p}:${k}`); if (k === 'k2') throw new Error('rpc'); return true })
  assert.deepEqual(seen, ['0xp:k0', '0xp:k2'])
  assert.equal(r.total, 2)
  assert.equal(r.verified, 1)
  assert.deepEqual(r.signatures.map((s) => [s.cp, s.request_id, s.verified]), [[0, 'r0', true], [2, 'r2', null]])
})
