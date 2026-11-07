// Company-side agent console for Faultline Studio: `npm run studio` -> http://127.0.0.1:8788
// Runs on the customer's machine next to their policy. Holds the Hedera payer key (from .env) and the run permits;
// the browser only sees public data. Serves apps/faultline-studio/dist and streams NDJSON events:
//   POST /api/buy     {suite, mode: 'quote'|'pay'}      x402 purchase steps (quote mode signs and spends nothing)
//   POST /api/launch  {jobId}                           starts run-paid-job.ts for a job bought here
//   POST /api/stream  {run, mode: 'live'|'replay', speed} episode events from a run directory
//   GET  /api/catalog, /api/runs, /api/runs/:name       public summaries (no salt, no permit, no keys)
// Spending guard: POST + custom header + Host check (no CORS), and at most FAULTLINE_CONSOLE_MAX_BUYS paid buys per process.
import 'dotenv/config'
import express, { type Request, type Response } from 'express'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { buy, buyerConfigFromEnv, hashscanTx, MIRROR, type Activation } from './buyer.ts'
import { SUITES, suiteOf } from './suites.ts'

const PORT = Number(process.env.FAULTLINE_CONSOLE_PORT ?? 8788)
const MAX_BUYS = Number(process.env.FAULTLINE_CONSOLE_MAX_BUYS ?? 3)
const ROOT = process.cwd()
const RUNS = resolve(ROOT, 'runs')
const DIST = resolve(ROOT, 'apps/faultline-studio/dist')
const STATE = process.env.HEDERA_JOB_STATE_DIR ?? join(ROOT, '.faultline-hedera-state')
const policyCommitment = () => `0x${createHash('sha256').update(readFileSync(resolve(ROOT, 'faultline/ego/pdm_lite.py'))).digest('hex')}`

const bought = new Map<string, Activation>() // jobId -> activation (permit stays in this process)
const procs = new Map<string, { child: ChildProcess, log: string[], exit: number | null, jobId: string }>() // run name -> runner
let buys = 0

// Same checks run-paid-job.ts makes before it consumes a permit, so nobody pays for a run that cannot start.
function runnerError(): string | null {
  const signer = process.env.FAULTLINE_CHAIN_SIGNER ?? 'PRIVATE_KEY'
  if (signer !== 'PRIVATE_KEY' && signer !== 'STUDIO_PRIVATE_KEY') return 'FAULTLINE_CHAIN_SIGNER must be PRIVATE_KEY or STUDIO_PRIVATE_KEY'
  if (!process.env[signer]) return `FAULTLINE_CHAIN_SIGNER names ${signer}, which is not set in .env`
  for (const n of ['ZG_ROUTER_URL', 'ZG_API_KEY', 'RPC_URL', 'STORAGE_INDEXER', 'FAULTLINE_TENANT_KEY']) if (!process.env[n]) return `${n} is not set in .env`
  if (!existsSync(resolve(ROOT, '.venv/bin/python'))) return '.venv/bin/python is missing'
  return null
}

// Paid jobs survive a console restart: re-activating a saved activation file is idempotent on the server
// (same payer + idempotency key returns the same job and permit), costs nothing, and never pays again.
async function recoverJobs() {
  if (!existsSync(STATE)) return
  const base = `http://127.0.0.1:${process.env.HEDERA_DEMO_PORT ?? '8787'}`
  for (const f of readdirSync(STATE).filter((n) => n.startsWith('activation-') && n.endsWith('.json'))) {
    try {
      const r = await fetch(`${base}/v1/stress-tests/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: readFileSync(join(STATE, f), 'utf8') })
      if (!r.ok) continue
      const a = await r.json() as Activation
      if (a.status === 'accepted' && !bought.has(a.jobId)) bought.set(a.jobId, a)
    } catch { /* service down: try again on the next catalog read */ }
  }
}
const pendingJobs = () => [...bought.values()].filter((j) => j.status === 'accepted' && ![...procs.values()].some((p) => p.jobId === j.jobId))
  .map((j) => ({ jobId: j.jobId, suite: j.suite, simulator: j.simulator, transaction: j.transaction, expiresAt: j.expiresAt, hashscan: hashscanTx(j.transaction) }))

const app = express()
app.use((req, res, next) => {
  const host = req.headers.host ?? ''
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) { res.status(421).end(); return }
  if (req.method === 'POST' && (req.header('x-faultline-console') !== '1' || !req.is('application/json'))) { res.status(403).end(); return }
  res.setHeader('Cache-Control', 'no-store')
  next()
})
app.use(express.json({ limit: '4kb' }))
app.use(express.static(DIST))

const ndjson = (res: Response) => {
  res.setHeader('content-type', 'application/x-ndjson')
  return (o: unknown) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n') }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const tcpOpen = (port: number) => new Promise<boolean>((done) => {
  const s = createConnection({ host: '127.0.0.1', port, timeout: 400 }, () => { s.destroy(); done(true) })
  s.on('error', () => done(false)); s.on('timeout', () => { s.destroy(); done(false) })
})
async function balance(account: string | undefined) {
  if (!account) return null
  try { const r = await fetch(`${MIRROR}/api/v1/accounts/${account}`); return r.ok ? ((await r.json()) as any).balance?.balance ?? null : null } catch { return null }
}

app.get('/api/catalog', async (_req, res) => {
  await recoverJobs()
  let cfg: ReturnType<typeof buyerConfigFromEnv> | null = null, cfgError: string | undefined
  try { cfg = buyerConfigFromEnv() } catch (e) { cfgError = (e as Error).message }
  const service = cfg ? await fetch(`${cfg.base}/.well-known/faultline-service.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null
  res.json({
    suites: Object.entries(SUITES).map(([id, s]) => ({ id, simulator: s.simulator })),
    service, serviceUp: !!service, carlaUp: await tcpOpen(2000), cfgError,
    payer: cfg?.payer ?? null, merchant: cfg?.merchant ?? null, cap: cfg?.cap ?? null,
    payerBalance: await balance(cfg?.payer), merchantBalance: await balance(cfg?.merchant),
    policyCommitment: policyCommitment(), policy: 'faultline/ego/pdm_lite.py (PDM-Lite)', buysLeft: Math.max(0, MAX_BUYS - buys),
    runnerError: runnerError(), pending: pendingJobs(),
  })
})

app.post('/api/buy', async (req: Request, res: Response) => {
  const send = ndjson(res)
  const mode = req.body?.mode === 'pay' ? 'pay' : 'quote'
  try {
    const { suite } = suiteOf(req.body?.suite)
    if (mode === 'pay' && buys >= MAX_BUYS) throw new Error(`console spend guard: ${MAX_BUYS} paid buys per session`)
    const notReady = mode === 'pay' ? runnerError() : null
    if (notReady) throw new Error(`runner not ready, nothing was paid: ${notReady}`)
    if (mode === 'pay') buys++
    const r = await buy(buyerConfigFromEnv(), { suite, policyCommitment: policyCommitment(), quoteOnly: mode === 'quote' }, (s) => send({ t: 'step', ...s }))
    if ('quoteOnly' in r) send({ t: 'done', quoteOnly: true })
    else {
      bought.set(r.jobId, r)
      send({ t: 'done', job: { jobId: r.jobId, suite: r.suite, simulator: r.simulator, transaction: r.transaction, expiresAt: r.expiresAt, hashscan: hashscanTx(r.transaction) } })
    }
  } catch (e) { send({ t: 'error', message: (e as Error).message }) }
  res.end()
})

app.post('/api/launch', async (req, res) => {
  if (!bought.has(String(req.body?.jobId))) await recoverJobs()
  const job = bought.get(String(req.body?.jobId))
  if (!job) { res.status(404).json({ error: 'unknown job' }); return }
  const notReady = runnerError()
  if (notReady) { res.status(409).json({ error: `runner not ready, permit unused: ${notReady}` }); return }
  if ([...procs.values()].some((p) => p.jobId === job.jobId)) { res.status(409).json({ error: 'already launched' }); return }
  const before = new Set(existsSync(RUNS) ? readdirSync(RUNS) : [])
  const child = spawn(resolve(ROOT, 'node_modules/.bin/tsx'), ['packages/hedera/src/run-paid-job.ts', job.jobId, job.permit, policyCommitment(), job.suite],
    { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  const entry = { child, log: [] as string[], exit: null as number | null, jobId: job.jobId }
  // The storage SDK prints option dumps and a 'Waiting for storage node to sync' line per second; keep the log readable.
  const NOISE = /^(Waiting for storage node|Upload options|First selected node|Selected nodes|  |\s*[{}\]\[]|Using splitable|File details|Data prepared|Attempting to find|Processing tasks|All tasks processed|Wait for log entry|Single file upload|Tasks created|Starting upload)/
  const onData = (b: Buffer) => entry.log.push(...b.toString().split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '')).filter((l) => l.trim() && !NOISE.test(l)))
  child.stdout!.on('data', onData); child.stderr!.on('data', onData)
  let exited = false
  child.on('exit', (c) => { entry.exit = c ?? 1; exited = true; if (c === 0) job.status = 'completed' })
  for (let i = 0; i < 300 && !exited; i++) { // up to 60 s for the permit check and the Galileo commit to create the run dir
    const name = existsSync(RUNS) ? readdirSync(RUNS).find((n) => n.startsWith(`paid-${job.jobId}-`) && !before.has(n)) : undefined
    if (name) { procs.set(name, entry); res.json({ run: name }); return }
    await sleep(200)
  }
  res.status(500).json({ error: 'runner did not start', log: entry.log.slice(-12) })
})

// Public subset of a run. anchor.json's salt and the sealed bundle are never served.
function runSummary(name: string) {
  const dir = join(RUNS, name)
  const m = readJson(join(dir, 'manifest.json')), a = readJson(join(dir, 'anchor.json')), p = readJson(join(dir, 'publish.json'))
  const met = readJson(join(dir, 'metrics.json'))
  const jobId = /^paid-([0-9a-f]{32})-/.exec(name)?.[1]
  const job = jobId ? (readJson(join(STATE, 'jobs.json')) as any[] | null)?.find((j) => j.jobId === jobId) : undefined
  return {
    name, jobId: jobId ?? null, status: m?.preliminary ? 'running' : m?.status ?? 'running', world: m?.world ?? null, family: m?.family ?? null,
    episodeId: m?.episode_id ?? null, model: m?.model ?? null, decisions: m?.decisions_total ?? null, decisions0g: m?.decisions_0g ?? null,
    ccs: met?.ccs ?? null, minTtc: met?.min_ttc_s ?? null, minGap: met?.min_gap_m ?? null, collision: met?.collision ?? null,
    startedAt: m?.started_at ?? null, finishedAt: m?.finished_at ?? null, mtime: statSync(dir).mtimeMs,
    chain: a ? { registry: a.registry, commitTx: a.commitTx, commitBlockTimestamp: a.commitBlockTimestamp, finalizeTx: a.finalizeTx ?? null, onchainMatches: a.onchainMatches ?? null } : null,
    storage: p ? { publicRoot: p.publicRoot, sealedRoot: p.sealedRoot, publicTx: p.publicTx, sealedTx: p.sealedTx, signaturesArchived: p.signatures_archived ?? null, signatures0g: p.signatures_0g ?? null } : null,
    payment: job ? { transaction: job.transaction, payer: job.payer, suite: job.suite, hashscan: hashscanTx(job.transaction) } : null,
  }
}
const isRunName = (n: unknown): n is string => typeof n === 'string' && /^[A-Za-z0-9._-]+$/.test(n) && existsSync(join(RUNS, n, 'decisions.jsonl'))

app.get('/api/runs', (_req, res) => {
  const names = existsSync(RUNS) ? readdirSync(RUNS).filter((n) => isRunName(n) && !n.includes('-replay-')) : []
  res.json(names.map(runSummary).sort((a, b) => b.mtime - a.mtime))
})
app.get('/api/runs/:name', (req, res) => {
  if (!isRunName(req.params.name)) { res.status(404).end(); return }
  res.json(runSummary(req.params.name))
})

// Episode events. Live: tail the files while the runner works. Replay: pace recorded files by sim time.
const DECISION_FIELDS = ['cp', 'sim_time_s', 'wall_clock_utc', 'action', 'source', 'reason', 'request_id', 'provider', 'zg_res_key', 'latency_ms', 'http_status'] as const
const TICK_FIELDS = ['t_s', 'ego_x', 'ego_v', 'ego_a', 'ego_lat_m', 'lead_x', 'lead_v', 'adv_lat_m', 'gt_gap', 'gt_ttc_s', 'ttc_s', 'lidar_gap', 'ccs', 'collision', 'gt_in_path'] as const
const pick = (o: any, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]))

class Tail {
  private off = 0; private rest = ''
  constructor(private path: string) {}
  lines(): any[] {
    if (!existsSync(this.path)) return []
    const buf = readFileSync(this.path)
    if (buf.length <= this.off) return []
    const text = this.rest + buf.subarray(this.off).toString('utf8'); this.off = buf.length
    const parts = text.split('\n'); this.rest = parts.pop() ?? ''
    return parts.filter(Boolean).map((l) => JSON.parse(l))
  }
}

app.post('/api/stream', async (req, res) => {
  const send = ndjson(res)
  const name = req.body?.run
  if (!isRunName(name) && !procs.has(name)) { send({ t: 'error', message: 'unknown run' }); res.end(); return }
  const dir = join(RUNS, name), live = req.body?.mode === 'live' && procs.has(name)
  const speed = Math.min(Math.max(Number(req.body?.speed) || 1, 0.25), 8)
  let closed = false; res.on('close', () => { closed = true })
  const phase = (id: string, status: string, title: string, data?: Record<string, unknown>) => send({ t: 'phase', id, status, title, data })

  if (!live) {
    const s = runSummary(name)
    const decisions = readFileSync(join(dir, 'decisions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => pick(JSON.parse(l), DECISION_FIELDS))
    const ticks = readFileSync(join(dir, 'trajectory.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => pick(JSON.parse(l), TICK_FIELDS))
    send({ t: 'meta', run: s, totalTicks: ticks.length, totalDecisions: decisions.length, mode: 'replay' })
    if (s.payment) phase('payment', 'ok', 'Payment settled on Hedera', s.payment)
    if (s.jobId) phase('permit', 'ok', 'Run permit accepted', { jobId: s.jobId })
    if (s.chain) phase('commit', 'ok', 'Scenario committed on 0G Galileo', { tx: s.chain.commitTx })
    phase('sim', 'run', `Simulation on ${s.world}`)
    let di = 0
    for (let i = 0; i < ticks.length && !closed; i++) {
      while (di < decisions.length && decisions[di].sim_time_s <= ticks[i].t_s + 1e-9) {
        send({ t: 'await0g', cp: decisions[di].cp })
        await sleep(Math.min(Number(decisions[di].latency_ms) || 0, 2600) / speed)
        send({ t: 'decision', d: decisions[di++] })
      }
      send({ t: 'ticks', rows: [ticks[i]] })
      await sleep(50 / speed)
    }
    if (closed) return
    phase('sim', 'ok', `Simulation on ${s.world}`, { ticks: ticks.length })
    if (s.storage) phase('storage', 'ok', 'Evidence on 0G Storage', s.storage)
    if (s.chain?.finalizeTx) phase('finalize', 'ok', 'Result finalized on 0G Galileo', { tx: s.chain.finalizeTx, onchainMatches: s.chain.onchainMatches })
    send({ t: 'done', run: s }); res.end(); return
  }

  const p = procs.get(name)!
  const dec = new Tail(join(dir, 'decisions.jsonl')), traj = new Tail(join(dir, 'trajectory.jsonl'))
  const job = bought.get(p.jobId)!
  send({ t: 'meta', run: runSummary(name), mode: 'live' })
  phase('payment', 'ok', 'Payment settled on Hedera', { transaction: job.transaction, hashscan: hashscanTx(job.transaction) })
  phase('permit', 'ok', 'Run permit accepted', { jobId: job.jobId })
  let logAt = 0, committed = false, simStarted = false, published = false, lastDecision = -1, halted = false, uploading = false
  while (!closed) {
    for (; logAt < p.log.length; logAt++) send({ t: 'log', line: p.log[logAt] })
    const a = readJson(join(dir, 'anchor.json'))
    if (!committed && a?.commitTx) { committed = true; phase('commit', 'ok', 'Scenario committed on 0G Galileo', { tx: a.commitTx }) }
    const rows = traj.lines()
    if (rows.length && !simStarted) { simStarted = true; phase('sim', 'run', 'Simulation running') }
    for (const d of dec.lines()) { lastDecision = d.cp; if (d.source === 'none') halted = true; send({ t: 'decision', d: pick(d, DECISION_FIELDS) }) }
    if (!uploading && existsSync(join(dir, 'manifest.json')) && !readJson(join(dir, 'manifest.json'))?.preliminary) {
      uploading = true; send({ t: 'idle' }); phase('sim', 'ok', 'Simulation finished'); phase('storage', 'run', 'Uploading to 0G Storage')
    }
    // Only while the episode can still ask 0G: not after a safe halt, not once the episode is written.
    if (simStarted && !halted && !uploading) send({ t: 'await0g', cp: lastDecision + 1, soft: true })
    if (rows.length) send({ t: 'ticks', rows: rows.map((r) => pick(r, TICK_FIELDS)) })
    const pub = readJson(join(dir, 'publish.json'))
    if (pub && !published) { published = true; phase('storage', 'ok', 'Evidence on 0G Storage', pub) }
    if (p.exit !== null) {
      for (const r of traj.lines()) send({ t: 'ticks', rows: [pick(r, TICK_FIELDS)] })
      const s = runSummary(name)
      if (s.chain?.finalizeTx) phase('finalize', 'ok', 'Result finalized on 0G Galileo', { tx: s.chain.finalizeTx, onchainMatches: s.chain.onchainMatches })
      for (; logAt < p.log.length; logAt++) send({ t: 'log', line: p.log[logAt] })
      send(p.exit === 0 ? { t: 'done', run: s } : { t: 'error', message: `runner exited ${p.exit}`, run: s })
      break
    }
    await sleep(250)
  }
  res.end()
})

app.listen(PORT, '127.0.0.1', () => console.log(`Faultline Studio on http://127.0.0.1:${PORT}  (agent console; payer key stays here)`))
