import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paidTransfer } from '../src/settlement.ts'

test('confirms exact HTS payer and merchant movement, ignoring fee HBAR', () => {
  const tx = { result: 'SUCCESS', transfers: [{ account: '0.0.9', amount: -10000 }], token_transfers: [
    { account: '0.0.1', token_id: '0.0.77', amount: -5 },
    { account: '0.0.2', token_id: '0.0.77', amount: 5 },
  ] }
  assert.equal(paidTransfer(tx, '0.0.77', '0.0.1', '0.0.2', 5n), true)
  assert.equal(paidTransfer(tx, '0.0.78', '0.0.1', '0.0.2', 5n), false)
  assert.equal(paidTransfer(tx, '0.0.77', '0.0.1', '0.0.2', 4n), false)
  assert.equal(paidTransfer({ ...tx, result: 'FAIL' }, '0.0.77', '0.0.1', '0.0.2', 5n), false)
})
