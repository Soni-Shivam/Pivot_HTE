import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeliveryReceipt } from './delivery-receipt.ts'

export type Job = {
  jobId: string
  suite: string // an id from suites.ts (legacy job 001: 'cut-in-v1')
  simulator?: string
  maxRuns: 1
  policyCommitment: string
  idempotencyKey: string
  requestHash: string
  payer: string
  transaction: string
  expiresAt: string
  status: 'accepted' | 'running' | 'completed' | 'interrupted' | 'failed'
  report?: Record<string, unknown>
  deliveryReceipt?: DeliveryReceipt
  hcs?: { state: 'pending' | 'confirmed' | 'uncertain'; topicId?: string; sequenceNumber?: string | null; transactionId?: string; digest: string }
}

const stateDir = process.env.HEDERA_JOB_STATE_DIR ?? join(process.cwd(), '.faultline-hedera-state')
mkdirSync(stateDir, { recursive: true, mode: 0o700 })
const stateFile = join(stateDir, 'jobs.json')
const secretFile = join(stateDir, 'permit-secret')
try { writeFileSync(secretFile, randomBytes(32), { flag: 'wx', mode: 0o600 }) } catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
}
const secret = readFileSync(secretFile)
let jobs: Job[] = []
try { jobs = JSON.parse(readFileSync(stateFile, 'utf8')) as Job[] } catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
}
const token = (job: Job) => createHmac('sha256', secret).update(`${job.jobId}:${job.transaction}:${job.requestHash}:${job.expiresAt}`).digest('hex')
export const intentToken = (requestHash: string) => createHmac('sha256', secret).update(`paid-intent:${requestHash}`).digest('hex')
export function validIntent(requestHash: string, supplied: unknown) {
  return typeof supplied === 'string' && /^[0-9a-f]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(intentToken(requestHash)), Buffer.from(supplied))
}
function persist() {
  const temp = join(stateDir, `jobs-${randomBytes(8).toString('hex')}.tmp`)
  writeFileSync(temp, JSON.stringify(jobs), { mode: 0o600 })
  // Rename is atomic on the local filesystem.
  renameSync(temp, stateFile)
}

export function findJob(id: string) { return jobs.find(j => j.jobId === id) }
export function acceptJob(input: Omit<Job, 'jobId' | 'expiresAt' | 'status'>) {
  const sameKey = jobs.find(j => j.payer === input.payer && j.idempotencyKey === input.idempotencyKey)
  if (sameKey) {
    if (sameKey.requestHash !== input.requestHash || sameKey.transaction !== input.transaction) throw new Error('idempotency_conflict')
    return { job: sameKey, permit: token(sameKey) }
  }
  if (jobs.some(j => j.transaction === input.transaction)) throw new Error('payment_already_bound')
  const job: Job = { ...input, jobId: createHash('sha256').update(input.transaction).digest('hex').slice(0, 32),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), status: 'accepted' }
  jobs.push(job)
  persist()
  return { job, permit: token(job) }
}
export function authorizedJob(id: string, permit: string) {
  const job = findJob(id)
  if (!job || !/^[0-9a-f]{64}$/.test(permit)) return undefined
  if (!timingSafeEqual(Buffer.from(token(job)), Buffer.from(permit))) return undefined
  if (Date.parse(job.expiresAt) < Date.now()) return undefined
  return job
}
export function updateJob(job: Job) { persist(); return job }
