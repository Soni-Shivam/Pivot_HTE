import 'dotenv/config'
import express from 'express'
import { createHash } from 'node:crypto'
import { verifyMessage } from 'viem'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { acceptJob, authorizedJob, intentToken, updateJob, validIntent } from './job-store.ts'
import { makeDeliveryReceipt, publishReceipt, receiptDigest, verifyDelivery } from './delivery-receipt.ts'

const merchant = process.env.HEDERA_MERCHANT_ACCOUNT_ID
const amount = process.env.HEDERA_PAYMENT_AMOUNT
const asset = process.env.HEDERA_PAYMENT_ASSET ?? '0.0.0'
const facilitatorUrl = process.env.HEDERA_FACILITATOR_URL ?? 'https://x402.org/facilitator'
const network = process.env.HEDERA_NETWORK ?? 'hedera:testnet'
if (!merchant || !/^0\.0\.[1-9][0-9]*$/.test(merchant)) throw new Error('Set HEDERA_MERCHANT_ACCOUNT_ID')
if (!amount || !/^[1-9][0-9]*$/.test(amount)) throw new Error('Set positive HEDERA_PAYMENT_AMOUNT')
if (network !== 'hedera:testnet' || asset !== '0.0.0') {
  throw new Error('The first paid check supports testnet HBAR only')
}

const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl })
const resourceServer = new x402ResourceServer(facilitator)
  .register('hedera:testnet', new ExactHederaScheme())
const app = express()
app.use(express.json({ limit: '4kb' }))
const suite = 'cut-in-v1'
app.get('/.well-known/faultline-service.json', (_req, res) => res.json({
  service: 'faultline', version: 1, network, asset, merchant, price: amount,
  suites: [{ id: suite, maxRuns: 1 }], endpoint: '/v1/stress-tests',
}))
app.use(paymentMiddleware({
  'GET /v1/paid-ping': {
    accepts: [{ scheme: 'exact', price: { amount, asset }, network: 'hedera:testnet', payTo: merchant, maxTimeoutSeconds: 180 }],
    description: 'Faultline Hedera testnet payment check',
    mimeType: 'application/json',
  },
  'POST /v1/stress-tests': {
    accepts: [{ scheme: 'exact', price: { amount, asset }, network: 'hedera:testnet', payTo: merchant, maxTimeoutSeconds: 180 }],
    description: 'One Faultline cut-in stress-test authorization',
    mimeType: 'application/json',
  },
}, resourceServer))
app.get('/v1/paid-ping', (_req, res) => res.json({ ok: true, service: 'faultline', network }))
app.post('/v1/stress-tests', (req, res) => {
  const body = req.body as Record<string, unknown> | undefined
  if (!body || body.suite !== suite || body.maxRuns !== 1 ||
      typeof body.policyCommitment !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.policyCommitment) ||
      typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.idempotencyKey)) {
    res.status(400).json({ error: 'invalid_test_request' })
    return
  }
  const requestHash = createHash('sha256').update(JSON.stringify({
    suite, maxRuns: 1, policyCommitment: body.policyCommitment.toLowerCase(), idempotencyKey: body.idempotencyKey,
  })).digest('hex')
  // This response is released by x402 only after facilitator settlement.
  // Job activation separately confirms that settlement on Mirror Node.
  res.json({ suite, requestHash, intentToken: intentToken(requestHash), activationEndpoint: '/v1/stress-tests/activate' })
})
app.post('/v1/stress-tests/activate', async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>
    if (!b || b.suite !== suite || b.maxRuns !== 1 ||
        typeof b.policyCommitment !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(b.policyCommitment) ||
        typeof b.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(b.idempotencyKey) ||
        typeof b.paymentResponse !== 'string' || b.paymentResponse.length > 4096) {
      res.status(400).json({ error: 'invalid_activation' }); return
    }
    const receipt = JSON.parse(Buffer.from(b.paymentResponse, 'base64').toString('utf8')) as Record<string, unknown>
    if (receipt.success !== true || receipt.network !== network ||
        typeof receipt.transaction !== 'string' || !/^0\.0\.[0-9]+@[0-9]+\.[0-9]+$/.test(receipt.transaction) ||
        typeof receipt.payer !== 'string' || !/^0\.0\.[0-9]+$/.test(receipt.payer)) {
      res.status(400).json({ error: 'invalid_receipt' }); return
    }
    const [account, time] = receipt.transaction.split('@')
    const mirrorId = `${account}-${time.replace('.', '-')}`
    const mirror = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/transactions/${mirrorId}`)
    if (!mirror.ok) { res.status(503).json({ error: 'settlement_unavailable' }); return }
    const data = await mirror.json() as { transactions?: Array<{ result: string, transfers?: Array<{ account: string, amount: number }> }> }
    const settled = data.transactions?.find(t => t.result === 'SUCCESS' &&
      t.transfers?.some(x => x.account === merchant && x.amount === Number(amount)) &&
      t.transfers?.some(x => x.account === receipt.payer && x.amount === -Number(amount)))
    if (!settled) { res.status(402).json({ error: 'settlement_not_confirmed' }); return }
    const policyCommitment = b.policyCommitment.toLowerCase()
    const requestHash = createHash('sha256').update(JSON.stringify({
      suite, maxRuns: 1, policyCommitment, idempotencyKey: b.idempotencyKey,
    })).digest('hex')
    if (!validIntent(requestHash, b.intentToken)) {
      res.status(403).json({ error: 'paid_intent_invalid' }); return
    }
    const accountResponse = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${receipt.payer}`)
    if (!accountResponse.ok) { res.status(503).json({ error: 'payer_lookup_unavailable' }); return }
    const payerAccount = await accountResponse.json() as { evm_address?: string }
    if (!payerAccount.evm_address || typeof b.payerSignature !== 'string' ||
        !await verifyMessage({ address: payerAccount.evm_address as `0x${string}`,
          message: `faultline:v1:${receipt.transaction}:${requestHash}`,
          signature: b.payerSignature as `0x${string}` })) {
      res.status(403).json({ error: 'payer_signature_invalid' }); return
    }
    const { job, permit } = acceptJob({ suite, maxRuns: 1, policyCommitment, idempotencyKey: b.idempotencyKey,
      requestHash, payer: receipt.payer, transaction: receipt.transaction })
    res.status(201).json({ jobId: job.jobId, status: job.status, permit, expiresAt: job.expiresAt, transaction: job.transaction })
  } catch (e) {
    res.status((e as Error).message === 'idempotency_conflict' || (e as Error).message === 'payment_already_bound' ? 409 : 400)
      .json({ error: (e as Error).message })
  }
})
app.get('/v1/stress-tests/:jobId', (req, res) => {
  const job = authorizedJob(req.params.jobId as string, String(req.header('authorization') ?? '').replace(/^Bearer /, ''))
  if (!job) { res.status(403).json({ error: 'invalid_permit' }); return }
  res.json({ jobId: job.jobId, status: job.status, suite: job.suite, requestHash: job.requestHash,
    report: job.report ?? null, deliveryReceipt: job.deliveryReceipt ?? null, hcs: job.hcs ?? null })
})
app.post('/v1/stress-tests/:jobId/start', (req, res) => {
  const job = authorizedJob(req.params.jobId as string, String(req.header('authorization') ?? '').replace(/^Bearer /, ''))
  if (!job) { res.status(403).json({ error: 'invalid_permit' }); return }
  if (job.status !== 'accepted' || req.body?.suite !== job.suite ||
      req.body?.policyCommitment?.toLowerCase() !== job.policyCommitment) {
    res.status(409).json({ error: 'run_not_authorized' }); return
  }
  job.status = 'running'
  updateJob(job)
  res.json({ jobId: job.jobId, status: job.status, maxRuns: job.maxRuns })
})
app.post('/v1/stress-tests/:jobId/report', async (req, res) => {
  const job = authorizedJob(req.params.jobId as string, String(req.header('authorization') ?? '').replace(/^Bearer /, ''))
  if (!job) { res.status(403).json({ error: 'invalid_permit' }); return }
  if (job.status !== 'running' || !['completed', 'interrupted', 'failed'].includes(req.body?.status) ||
      typeof req.body?.report !== 'object' || !req.body.report) {
    res.status(409).json({ error: 'invalid_run_report' }); return
  }
  if (req.body.status === 'completed') {
    try {
      const receipt = makeDeliveryReceipt(job, req.body.report)
      if (!process.env.RPC_URL || !process.env.STORAGE_INDEXER) throw new Error('evidence_verifier_unconfigured')
      await verifyDelivery(receipt, { rpcUrl: process.env.RPC_URL, indexerUrl: process.env.STORAGE_INDEXER })
      job.deliveryReceipt = receipt
      job.hcs = { state: 'pending', digest: receiptDigest(receipt) }
    } catch (e) { res.status(422).json({ error: (e as Error).message }); return }
  }
  job.status = req.body.status
  job.report = req.body.report
  updateJob(job)
  const topicId = process.env.HEDERA_HCS_TOPIC_ID
  const accountId = process.env.HEDERA_HCS_OPERATOR_ACCOUNT_ID
  const privateKey = process.env.HEDERA_HCS_OPERATOR_PRIVATE_KEY
  if (job.deliveryReceipt && topicId && accountId && privateKey) {
    try {
      const hcs = await publishReceipt(job.deliveryReceipt, { topicId, accountId, privateKey })
      job.hcs = { state: 'confirmed', ...hcs }
      updateJob(job)
    } catch {
      // A submit timeout is ambiguous: keep the digest pending for Mirror Node reconciliation.
      job.hcs = { state: 'uncertain', digest: receiptDigest(job.deliveryReceipt), topicId }
      updateJob(job)
    }
  }
  res.status(job.hcs?.state === 'confirmed' ? 200 : 202)
    .json({ jobId: job.jobId, status: job.status, hcs: job.hcs ?? null })
})
app.post('/v1/stress-tests/:jobId/receipt/reconcile', async (req, res) => {
  const job = authorizedJob(req.params.jobId as string, String(req.header('authorization') ?? '').replace(/^Bearer /, ''))
  if (!job || !job.deliveryReceipt || !job.hcs) { res.status(403).json({ error: 'receipt_unavailable' }); return }
  if (job.hcs.state === 'confirmed') { res.json(job.hcs); return }
  const topicId = job.hcs.topicId ?? process.env.HEDERA_HCS_TOPIC_ID
  if (!topicId) { res.status(409).json({ error: 'hcs_topic_unconfigured' }); return }
  try {
    const mirror = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/topics/${topicId}/messages?limit=100&order=desc`)
    if (!mirror.ok) { res.status(503).json({ error: 'mirror_unavailable' }); return }
    const body = await mirror.json() as { messages?: Array<{ message: string; sequence_number: number }> }
    const found = body.messages?.find(m => {
      try { return receiptDigest(JSON.parse(Buffer.from(m.message, 'base64').toString('utf8'))) === job.hcs?.digest }
      catch { return false }
    })
    if (!found) { res.status(202).json({ state: job.hcs.state, digest: job.hcs.digest }); return }
    job.hcs = { ...job.hcs, state: 'confirmed', topicId, sequenceNumber: String(found.sequence_number) }
    updateJob(job)
    res.json(job.hcs)
  } catch { res.status(503).json({ error: 'mirror_unavailable' }) }
})

const port = Number(process.env.HEDERA_DEMO_PORT ?? 8787)
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid HEDERA_DEMO_PORT')
app.listen(port, '127.0.0.1', () => { console.log(`Faultline paid check on http://127.0.0.1:${port}`) })
