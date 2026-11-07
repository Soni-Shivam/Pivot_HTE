import { createHash } from 'node:crypto'
import { Client, PrivateKey, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { storage } from '@sealedai/integrations'
import { checkPublic } from '../../episode/src/check.ts'
import { checkOnchain } from '../../episode/src/onchain.ts'
import type { Job } from './job-store.ts'

const hex32 = /^0x[0-9a-f]{64}$/
export type DeliveryReceipt = {
  schema: 'faultline.delivery/v1'
  network: 'hedera:testnet'
  jobId: string
  paymentTxId: string
  requestHash: string
  policyCommitment: string
  suite: 'cut-in-v1'
  suiteVersion: 1
  status: 'evidence-checked'
  episodeId: string
  publicRoot: string
  sealedRoot: string
}

export function makeDeliveryReceipt(job: Job, report: Record<string, unknown>): DeliveryReceipt {
  if (job.status !== 'running' || !hex32.test(String(report.publicRoot)) ||
      !hex32.test(String(report.sealedRoot)) || !/^[0-9a-f]{64}$/.test(String(report.episodeId)))
    throw new Error('invalid_delivery_report')
  return {
    schema: 'faultline.delivery/v1', network: 'hedera:testnet', jobId: job.jobId,
    paymentTxId: job.transaction, requestHash: job.requestHash,
    policyCommitment: job.policyCommitment, suite: job.suite, suiteVersion: 1,
    status: 'evidence-checked', episodeId: String(report.episodeId),
    publicRoot: String(report.publicRoot), sealedRoot: String(report.sealedRoot),
  }
}

export const receiptDigest = (receipt: DeliveryReceipt) =>
  createHash('sha256').update(JSON.stringify(receipt)).digest('hex')

/** The downloaded Merkle root, manifest metrics, Galileo record and paid-job binding must all agree. */
export async function verifyDelivery(receipt: DeliveryReceipt, cfg: { rpcUrl: string; indexerUrl: string }) {
  const bytes = await storage(cfg).downloadBlob(receipt.publicRoot)
  const pub = JSON.parse(new TextDecoder().decode(bytes))
  const m = pub.manifest
  const b = m?.paid_binding
  const expectedBinding = { jobId: receipt.jobId, requestHash: receipt.requestHash,
    policyCommitment: receipt.policyCommitment, suite: receipt.suite, suiteVersion: receipt.suiteVersion }
  // Python's canonical() is sorted JSON. Reconstruct the same hash here rather than trusting the manifest's digest.
  const sorted = Object.fromEntries(Object.entries(expectedBinding).sort(([a], [b]) => a.localeCompare(b)))
  const bindingHash = `0x${createHash('sha256').update(JSON.stringify(sorted)).digest('hex')}`
  if (!b || Object.entries(expectedBinding).some(([k, v]) => b[k] !== v) ||
      m.config?.paid_binding_hash !== bindingHash || m.episode_id !== receipt.episodeId ||
      m.world !== 'kinematic-cut-in' || m.family !== 'cut_in' || m.status !== 'completed') {
    throw new Error('paid_evidence_binding_mismatch')
  }
  const checks = checkPublic(pub)
  if (!checks.filesOk || !checks.decisionsOk || !checks.metricsRecomputedOk || !checks.aggregatesOk)
    throw new Error('published_evidence_invalid')
  const chain = await checkOnchain(pub, receipt.publicRoot)
  if (!chain.ok || chain.sealedRoot?.toLowerCase() !== receipt.sealedRoot) throw new Error('galileo_anchor_mismatch')
  return { episodeId: m.episode_id, metrics: checks.metrics, onchain: chain.ok }
}

export async function publishReceipt(receipt: DeliveryReceipt, cfg: { accountId: string; privateKey: string; topicId: string }) {
  if (!/^0\.0\.[1-9][0-9]*$/.test(cfg.topicId)) throw new Error('invalid_hcs_topic')
  const client = Client.forTestnet().setOperator(cfg.accountId, PrivateKey.fromStringECDSA(cfg.privateKey.replace(/^0x/, '')))
  try {
    const result = await new TopicMessageSubmitTransaction().setTopicId(cfg.topicId)
      .setMessage(JSON.stringify(receipt)).execute(client)
    const confirmed = await result.getReceipt(client)
    return { topicId: cfg.topicId, sequenceNumber: confirmed.topicSequenceNumber?.toString() ?? null,
      transactionId: result.transactionId.toString(), digest: receiptDigest(receipt) }
  } finally { client.close() }
}
