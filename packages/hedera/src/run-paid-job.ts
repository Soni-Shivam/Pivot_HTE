import 'dotenv/config'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runnerArgs, suiteOf } from './suites.ts'
import { kinematicPolicyCommitment } from './kinematic-policy.ts'

const [jobId, permit, policyCommitment, wantedSuite] = process.argv.slice(2)
if (!/^[0-9a-f]{32}$/.test(jobId ?? '') || !/^[0-9a-f]{64}$/.test(permit ?? '') ||
    !/^0x[0-9a-fA-F]{64}$/.test(policyCommitment ?? '') || !wantedSuite) {
  throw new Error('usage: npm run hedera:run -- <jobId> <permit> <0x-policy-commitment> <cut-in-v1-kinematic|cut-in-v1-carla>')
}
const { suite, simulator } = suiteOf(wantedSuite)
// kinematic suite: the ego is the IDM in controller.py/cutin.py; CARLA suite: PDM-Lite (Vedant's correction, PR #2)
const actualPolicyCommitment = suite.endsWith('-kinematic') ? kinematicPolicyCommitment()
  : `0x${createHash('sha256').update(readFileSync(resolve('faultline/ego/pdm_lite.py'))).digest('hex')}`
if (policyCommitment.toLowerCase() !== actualPolicyCommitment) throw new Error(`Policy commitment does not match the ${suite} policy`)
const base = `http://127.0.0.1:${process.env.HEDERA_DEMO_PORT ?? '8787'}`
// Explicit choice of which .env key signs Galileo txs (job 001 used FAULTLINE_CHAIN_SIGNER=STUDIO_PRIVATE_KEY).
const signer = process.env.FAULTLINE_CHAIN_SIGNER ?? 'PRIVATE_KEY'
if (signer !== 'PRIVATE_KEY' && signer !== 'STUDIO_PRIVATE_KEY') throw new Error('FAULTLINE_CHAIN_SIGNER must be PRIVATE_KEY or STUDIO_PRIVATE_KEY')
if (!process.env[signer]) throw new Error(`FAULTLINE_CHAIN_SIGNER names ${signer}, which is not set`)
process.env.PRIVATE_KEY = process.env[signer]
for (const name of ['ZG_ROUTER_URL', 'ZG_API_KEY', 'RPC_URL', 'STORAGE_INDEXER', 'PRIVATE_KEY', 'FAULTLINE_TENANT_KEY']) {
  if (!process.env[name]) throw new Error(`${name} is required for a paid anchored run`)
}
const endpoint = `${base}/v1/stress-tests/${jobId}`
const headers = { authorization: `Bearer ${permit}`, 'content-type': 'application/json' }
const jobResponse = await fetch(endpoint, { headers })
if (!jobResponse.ok) throw new Error(`Job lookup failed: HTTP ${jobResponse.status}`)
const job = await jobResponse.json() as { suite?: unknown, simulator?: unknown, requestHash: string }
if (!/^[0-9a-f]{64}$/.test(job.requestHash ?? '')) throw new Error('Job request hash missing')
const args = runnerArgs(suite, job) // throws before the permit is consumed
const start = await fetch(`${endpoint}/start`, { method: 'POST', headers,
  body: JSON.stringify({ suite, simulator, policyCommitment }) })
if (!start.ok) throw new Error(`Run permit rejected: HTTP ${start.status}`)

const out = resolve('runs', `paid-${jobId}-${Date.now()}`)
// The existing Faultline CLI sources nvm for its 0G commands; npm's global prefix conflicts with nvm.
const childEnv = { ...process.env }
delete childEnv.npm_config_prefix
childEnv.FAULTLINE_PAID_JOB = JSON.stringify({ jobId, requestHash: job.requestHash,
  policyCommitment: policyCommitment.toLowerCase(), suite, suiteVersion: simulator })
const child = spawn(resolve('.venv/bin/python'), ['-m', 'faultline', 'run', ...args, '--out', out],
  { stdio: 'inherit', env: childEnv })
const exitCode = await new Promise<number>((done, reject) => {
  child.on('error', reject)
  child.on('exit', code => done(code ?? 1))
})
let report: Record<string, unknown> = { outputDirectory: out }
try {
  const manifest = JSON.parse(await readFile(resolve(out, 'manifest.json'), 'utf8')) as Record<string, unknown>
  report = { suite, simulator, world: manifest.world, episodeId: manifest.episode_id, status: manifest.status, publicRoot: manifest.public_root,
    sealedRoot: manifest.sealed_root, commitTx: manifest.commit_tx, finalizeTx: manifest.finalize_tx,
    logHead: manifest.log_head, outputDirectory: out }
} catch { /* An interrupted run may not have produced a manifest. */ }
const status = exitCode === 0 && report.status === 'completed' && report.publicRoot && report.finalizeTx && report.world === simulator ? 'completed' : 'interrupted'
if (status !== 'completed') report.interruption = exitCode !== 0 ? `faultline exited ${exitCode}`
  : report.world !== simulator ? `ran ${String(report.world)}, paid for ${simulator}`
  : report.status !== 'completed' ? `episode ${String(report.status)}` : 'no anchored publication'
const response = await fetch(`${endpoint}/report`, { method: 'POST', headers,
  body: JSON.stringify({ status, report }) })
if (!response.ok) throw new Error(`Could not record run outcome: HTTP ${response.status}`)
console.log(JSON.stringify({ jobId, status, report }, null, 2))
if (status !== 'completed') process.exitCode = 1
