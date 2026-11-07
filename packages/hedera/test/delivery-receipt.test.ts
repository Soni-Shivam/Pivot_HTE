import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configHashOf } from '../../episode/src/onchain.ts'
import { makeDeliveryReceipt, receiptDigest } from '../src/delivery-receipt.ts'
import type { Job } from '../src/job-store.ts'

const job: Job = {
  jobId: 'a'.repeat(32), suite: 'cut-in-v1', maxRuns: 1,
  policyCommitment: `0x${'b'.repeat(64)}`, idempotencyKey: 'c'.repeat(32),
  requestHash: 'd'.repeat(64), payer: '0.0.1001', transaction: '0.0.1001@1234567890.000000001',
  expiresAt: '2099-01-01T00:00:00.000Z', status: 'running',
}
const report = { episodeId: 'e'.repeat(64), publicRoot: `0x${'f'.repeat(64)}`,
  sealedRoot: `0x${'1'.repeat(64)}`, finalizeTx: `0x${'2'.repeat(64)}` }

test('delivery receipt commits to the paid job and evidence without policy bytes', () => {
  const receipt = makeDeliveryReceipt(job, report)
  assert.equal(receipt.policyCommitment, job.policyCommitment)
  assert.equal(receipt.paymentTxId, job.transaction)
  assert.equal(receipt.publicRoot, report.publicRoot)
  assert.equal(receipt.resultStatus, 'completed')
  assert.equal(receipt.evidenceCheck, 'passed')
  assert.equal(Object.values(receipt).some(x => typeof x === 'object'), false)
  assert.notEqual(receiptDigest(receipt), receiptDigest({ ...receipt, publicRoot: `0x${'3'.repeat(64)}` }))
  assert.throws(() => makeDeliveryReceipt(job, { ...report, publicRoot: '0x0' }), /invalid_delivery_report/)
})

test('paid binding changes Galileo config hash while legacy config stays compatible', () => {
  const config = { prompt_hash: 'a'.repeat(64), model: '0gm-1.0-35b-a3b', git_commit: 'c'.repeat(40) }
  const legacy = configHashOf(config)
  const paid = configHashOf({ ...config, paid_binding_hash: `0x${'1'.repeat(64)}` })
  assert.notEqual(paid, legacy)
  assert.notEqual(paid, configHashOf({ ...config, paid_binding_hash: `0x${'2'.repeat(64)}` }))
  assert.equal(legacy, configHashOf({ ...config }))
})
