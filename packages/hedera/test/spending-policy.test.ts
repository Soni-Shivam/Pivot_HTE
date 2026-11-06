import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { authorizePayment, type HederaExactRequirements, type SpendingPolicy } from '../src/spending-policy.ts'

const policy: SpendingPolicy = {
  network: 'hedera:testnet', asset: '0.0.6001', merchantAccounts: ['0.0.1234'],
  feePayerAccounts: ['0.0.9185802'], maxPerJob: 500n, maxTotal: 1000n,
  alreadySpent: 400n, maxTimeoutSeconds: 180,
}
const quote: HederaExactRequirements = {
  scheme: 'exact', network: 'hedera:testnet', amount: '500', asset: '0.0.6001',
  payTo: '0.0.1234', maxTimeoutSeconds: 180, extra: { feePayer: '0.0.9185802' },
}

test('authorizes an allowlisted quote within both spending caps', () => {
  assert.equal(authorizePayment(quote, policy), 500n)
})

test('rejects altered recipient, network, asset, fee payer and amount before signing', () => {
  const variants: Partial<HederaExactRequirements>[] = [
    { payTo: '0.0.9999' }, { network: 'hedera:mainnet' }, { asset: '0.0.9999' },
    { extra: { feePayer: '0.0.9999' } }, { amount: '501' }, { amount: '5e2' },
  ]
  for (const variant of variants) {
    assert.throws(() => authorizePayment({ ...quote, ...variant }, policy))
  }
})

test('rejects a payment when remaining total budget is insufficient', () => {
  assert.throws(() => authorizePayment(quote, { ...policy, alreadySpent: 501n }), /Total spending cap/)
})
