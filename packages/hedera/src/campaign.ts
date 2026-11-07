import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buy, buyerConfigFromEnv } from './buyer.ts'
import { SUITES } from './suites.ts'

type Campaign = {
  schema: 'faultline.campaign/v1'
  id: string
  suite: string
  policyCommitment: string
  asset: string
  amountPerRun: string
  maxTotal: string
  intervalSeconds: number
  nextDue: string
  state: 'ready' | 'purchase_in_progress'
  purchases: Array<{ due: string; jobId: string; transaction: string; amount: string }>
}

const cfg = buyerConfigFromEnv()
const path = join(cfg.stateDir, 'campaign.json')
function save(campaign: Campaign) {
  mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(campaign, null, 2), { mode: 0o600 })
  renameSync(temp, path)
}

const [command, ...args] = process.argv.slice(2)
if (command === 'init') {
  const [suite, policyCommitment, interval, count] = args
  if (!suite || !Object.hasOwn(SUITES, suite) || !/^0x[0-9a-fA-F]{64}$/.test(policyCommitment ?? '') ||
      !/^[1-9][0-9]*$/.test(interval ?? '') || !/^[1-9][0-9]*$/.test(count ?? ''))
    throw new Error('Usage: npm run hedera:campaign -- init <suite> <0x-policy-commitment> <interval-seconds> <run-count>')
  const intervalSeconds = Number(interval), runs = Number(count)
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 10 || !Number.isSafeInteger(runs) || runs > 100)
    throw new Error('Interval must be at least 10 seconds and count at most 100')
  try { readFileSync(path); throw new Error('Campaign already exists; use a new state directory') }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  const campaign: Campaign = { schema: 'faultline.campaign/v1', id: randomUUID(), suite, policyCommitment,
    asset: cfg.asset, amountPerRun: cfg.cap, maxTotal: (BigInt(cfg.cap) * BigInt(runs)).toString(),
    intervalSeconds, nextDue: new Date().toISOString(), state: 'ready', purchases: [] }
  save(campaign)
  console.log(JSON.stringify({ campaignId: campaign.id, nextDue: campaign.nextDue, maxTotal: campaign.maxTotal, asset: campaign.asset }))
} else if (command === 'tick') {
  const lock = `${path}.lock`
  closeSync(openSync(lock, 'wx', 0o600))
  const campaign = JSON.parse(readFileSync(path, 'utf8')) as Campaign
  if (campaign.schema !== 'faultline.campaign/v1' || campaign.asset !== cfg.asset || campaign.amountPerRun !== cfg.cap)
    throw new Error('Campaign payment policy changed')
  if (campaign.state !== 'ready') throw new Error('Previous purchase needs reconciliation; refusing another charge')
  const spent = campaign.purchases.reduce((sum, x) => sum + BigInt(x.amount), 0n)
  if (spent + BigInt(cfg.cap) > BigInt(campaign.maxTotal)) {
    unlinkSync(lock)
    console.log(JSON.stringify({ status: 'complete', purchases: campaign.purchases.length })); process.exit(0)
  }
  if (Date.now() < Date.parse(campaign.nextDue)) {
    unlinkSync(lock)
    console.log(JSON.stringify({ status: 'not_due', nextDue: campaign.nextDue })); process.exit(0)
  }
  const due = campaign.nextDue
  campaign.state = 'purchase_in_progress'
  save(campaign)
  // A crash after settlement leaves the campaign halted. Recover the paid activation file; never double charge.
  const result = await buy(cfg, { suite: campaign.suite, policyCommitment: campaign.policyCommitment })
  if ('quoteOnly' in result) throw new Error('Unexpected quote-only result')
  campaign.purchases.push({ due, jobId: result.jobId, transaction: result.transaction, amount: cfg.cap })
  campaign.nextDue = new Date(Date.now() + campaign.intervalSeconds * 1000).toISOString()
  campaign.state = 'ready'
  save(campaign)
  unlinkSync(lock)
  console.log(JSON.stringify({ status: 'purchased', jobId: result.jobId, transaction: result.transaction,
    nextDue: campaign.nextDue, spent: campaign.purchases.reduce((sum, x) => sum + BigInt(x.amount), 0n).toString() }))
} else throw new Error('Usage: npm run hedera:campaign -- init|tick ...')
