// Company-side agent console for Faultline Studio: `npm run studio` -> http://127.0.0.1:8788
// Runs on the customer's machine next to their policy. Holds the Hedera payer key (from .env) and the run permits;
// the browser only sees public data. Serves apps/faultline-studio/dist and streams NDJSON events:
//   POST /api/buy     {suite, mode: 'quote'|'pay'}      x402 purchase steps (quote mode signs and spends nothing)
//   POST /api/launch  {jobId}                           starts run-paid-job.ts for a job bought here
//   POST /api/stream  {run, mode: 'live'|'replay', speed} episode events from a run directory
//   GET  /api/catalog, /api/runs, /api/runs/:name       public summaries (no salt, no permit, no keys)
// Spending guard: POST + custom header + Host check, and at most FAULTLINE_CONSOLE_MAX_BUYS paid buys per UTC day.
// Public mode (docs/BACKEND.md): Tailscale Funnel proxies FAULTLINE_PUBLIC_HOST to 127.0.0.1; CORS only for
// FAULTLINE_PUBLIC_ORIGINS; per-IP rate limit; daily caps; one CARLA job at a time. New endpoints: /api/health,
// /api/policies, /api/demo-run, /api/arena, /api/jobs/:id, /api/stream {job}, /api/showcase, /media/<path>.
import 'dotenv/config'
import express, { type Request, type Response } from 'express'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join, relative, resolve } from 'node:path'
import { buy, buyerConfigFromEnv, hashscanTx, MIRROR, type Activation } from './buyer.ts'
import { verifyMessage } from 'viem'
import { clientIp, DailyCaps, mediaPath, parseOrigins, RateLimit, verifyRunRequest, WalletCaps } from './console-guard.ts'
import { SUITES, suiteOf } from './suites.ts'

const PORT = Number(process.env.FAULTLINE_CONSOLE_PORT ?? 8788)
const MAX_BUYS = Number(process.env.FAULTLINE_CONSOLE_MAX_BUYS ?? 6)
const MAX_RUNS = Number(process.env.FAULTLINE_CONSOLE_MAX_RUNS ?? 20) // live 0G runs per day (free + paid); counts runs, not dollars
const PUBLIC_HOST = process.env.FAULTLINE_PUBLIC_HOST ?? 'sedrica-w.tail1b988f.ts.net'
const ORIGINS = parseOrigins(process.env.FAULTLINE_PUBLIC_ORIGINS)
const ROOT = process.cwd()
const RUNS = resolve(ROOT, 'runs')
const DIST = resolve(ROOT, 'apps/faultline-studio/dist')
const STATE = process.env.HEDERA_JOB_STATE_DIR ?? join(ROOT, '.faultline-hedera-state')
const policyCommitment = () => `0x${createHash('sha256').update(readFileSync(resolve(ROOT, 'faultline/ego/pdm_lite.py'))).digest('hex')}`

const bought = new Map<string, Activation>() // jobId -> activation (permit stays in this process)
const procs = new Map<string, { child: ChildProcess, log: string[], exit: number | null, jobId: string }>() // run name -> runner
const caps = new DailyCaps(join(RUNS, 'backend', 'caps.json'), MAX_BUYS, MAX_RUNS)
const PAUSED = 'Live runs are paused for today. Replay a recorded run'
// Live runs need a wallet-signed request (EIP-191); nonces are single-use (in memory: a restart within 5 min forgets them).
const nonces = new Map<string, number>()
const walletCaps = new WalletCaps(Number(process.env.FAULTLINE_WALLET_MAX_RUNS ?? 3))
// Guest path (no wallet): free demo runs only, 1 per IP per hour, 6 per day in total. Paid runs always need a signature.
const guestKey = (req: Request) => req.header('x-vercel-forwarded-for')?.split(',')[0].trim() || clientIp(req.socket.remoteAddress, req.header('x-forwarded-for'))
// A double click must not start two runs: the same visitor (wallet or network) within 30 s gets the job it already has.
const recentStart = new Map<string, { jobId: string, at: number }>()
const guestPerIp = new RateLimit(Number(process.env.FAULTLINE_GUEST_PER_IP_HOUR ?? 3), 3600_000), guestDaily = new WalletCaps(Number(process.env.FAULTLINE_GUEST_MAX_RUNS ?? 30))
const postLimit = new RateLimit(Number(process.env.FAULTLINE_RATE_POST ?? 12), 60_000)
const allLimit = new RateLimit(Number(process.env.FAULTLINE_RATE_ALL ?? 600), 60_000)
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, PUBLIC_HOST, `${PUBLIC_HOST}:443`])

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
app.set('trust proxy', false)
app.use((req, res, next) => {
  const host = req.headers.host ?? ''
  if (!HOSTS.has(host)) { res.status(421).end(); return }
  const ip = clientIp(req.socket.remoteAddress, req.header('x-forwarded-for'))
  if (!allLimit.allow(ip) || (req.method === 'POST' && !postLimit.allow(ip))) { res.status(429).json({ error: 'Too many requests. Wait a minute' }); return }
  const origin = req.header('origin')
  const sameOrigin = origin === `https://${PUBLIC_HOST}` || origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`
  if (origin && ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-faultline-console, range')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
    res.setHeader('Access-Control-Expose-Headers', 'content-range, accept-ranges, content-length')
    // Chrome Private Network Access: tailnet devices resolve the Funnel host to a 100.x address and preflight with this
    if (req.header('access-control-request-private-network') === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true')
    if (req.method === 'OPTIONS') { res.status(204).end(); return }
  } else if (origin && !sameOrigin && req.method !== 'GET' && req.method !== 'HEAD') { res.status(403).json({ error: 'origin not allowed' }); return }
  if (req.method === 'POST' && (req.header('x-faultline-console') !== '1' || !req.is('application/json'))) { res.status(403).end(); return }
  if (!req.path.startsWith('/media/')) res.setHeader('Cache-Control', 'no-store')
  next()
})
app.use(express.json({ limit: '4kb' }))
app.use(express.static(DIST))
// SPA routes of the studio (same list as the Vercel fallback rewrite)
app.get(/^\/(lab|mission|verify|research|results|library|stack)(\/[^.]*)?$/, (_req, res) => { res.sendFile(join(DIST, 'index.html')) })

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
    policyCommitment: policyCommitment(), policy: 'faultline/ego/pdm_lite.py (PDM-Lite)', buysLeft: caps.left().buys_left,
    runnerError: runnerError(), pending: pendingJobs(),
  })
})

app.post('/api/buy', async (req: Request, res: Response) => {
  const send = ndjson(res)
  const mode = req.body?.mode === 'pay' ? 'pay' : 'quote'
  try {
    const { suite } = suiteOf(req.body?.suite)
    if (mode === 'pay') {
      const v = await verifyRunRequest(req.body, { policy: 'pdm-lite', suite, mode: 'paid' }, nonces, verifyMessage)
      if ('error' in v) throw new Error(v.error)
      if (!walletCaps.take(v.address)) throw new Error('This wallet has used its live runs for today. Replay a recorded run')
      appendLive(`buy requested_by ${v.address} ${suite}`)
    }
    const notReady = mode === 'pay' ? runnerError() : null
    if (notReady) throw new Error(`runner not ready, nothing was paid: ${notReady}`)
    if (mode === 'pay' && !caps.take('buys')) throw new Error(`${PAUSED} (${MAX_BUYS} paid buys per day used)`)
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
  const r = await launchPaid(job)
  if ('run' in r) res.json(r); else res.status(r.code).json({ error: r.error, log: r.log })
})

type Proc = { child: ChildProcess, log: string[], exit: number | null, jobId: string }
async function launchPaid(job: Activation): Promise<{ run: string, entry: Proc } | { code: number, error: string, log?: string[] }> {
  const notReady = runnerError()
  if (notReady) return { code: 409, error: `runner not ready, permit unused: ${notReady}` }
  if ([...procs.values()].some((p) => p.jobId === job.jobId)) return { code: 409, error: 'already launched' }
  const before = new Set(existsSync(RUNS) ? readdirSync(RUNS) : [])
  const child = spawn(resolve(ROOT, 'node_modules/.bin/tsx'), ['packages/hedera/src/run-paid-job.ts', job.jobId, job.permit, policyCommitment(), job.suite],
    { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  const entry: Proc = { child, log: [], exit: null, jobId: job.jobId }
  // The storage SDK prints option dumps and a 'Waiting for storage node to sync' line per second; keep the log readable.
  const NOISE = /^(Waiting for storage node|Upload options|First selected node|Selected nodes|  |\s*[{}\]\[]|Using splitable|File details|Data prepared|Attempting to find|Processing tasks|All tasks processed|Wait for log entry|Single file upload|Tasks created|Starting upload)/
  const onData = (b: Buffer) => entry.log.push(...b.toString().split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '')).filter((l) => l.trim() && !NOISE.test(l)))
  child.stdout!.on('data', onData); child.stderr!.on('data', onData)
  let exited = false
  child.on('exit', (c) => { entry.exit = c ?? 1; exited = true; if (c === 0) job.status = 'completed' })
  for (let i = 0; i < 300 && !exited; i++) { // up to 60 s for the permit check and the Galileo commit to create the run dir
    const name = existsSync(RUNS) ? readdirSync(RUNS).find((n) => n.startsWith(`paid-${job.jobId}-`) && !before.has(n)) : undefined
    if (name) { procs.set(name, entry); return { run: name, entry } }
    await sleep(200)
  }
  return { code: 500, error: 'runner did not start', log: entry.log.slice(-12) }
}

// Public subset of a run. anchor.json's salt and the sealed bundle are never served.
function runSummary(name: string) {
  const dir = join(RUNS, name)
  const m = readJson(join(dir, 'manifest.json')), a = readJson(join(dir, 'anchor.json')), p = readJson(join(dir, 'publish.json'))
  const met = readJson(join(dir, 'metrics.json')), sig = readJson(join(dir, 'decisions.jsonl.sigs.json'))
  const jobId = /^paid-([0-9a-f]{32})-/.exec(name)?.[1]
  const job = jobId ? (readJson(join(STATE, 'jobs.json')) as any[] | null)?.find((j) => j.jobId === jobId) : undefined
  return {
    name, jobId: jobId ?? null, status: m?.preliminary ? 'running' : m?.status ?? 'running', world: m?.world ?? null, family: m?.family ?? null,
    episodeId: m?.episode_id ?? null, model: m?.model ?? null, decisions: m?.decisions_total ?? null, decisions0g: m?.decisions_0g ?? null,
    ccs: met?.ccs ?? null, minTtc: met?.min_ttc_s ?? null, minGap: met?.min_gap_m ?? null, collision: met?.collision ?? null,
    startedAt: m?.started_at ?? null, finishedAt: m?.finished_at ?? null, mtime: statSync(dir).mtimeMs,
    chain: a ? { registry: a.registry, commitTx: a.commitTx, commitBlockTimestamp: a.commitBlockTimestamp, finalizeTx: a.finalizeTx ?? null, onchainMatches: a.onchainMatches ?? null } : null,
    storage: p ? { publicRoot: p.publicRoot, sealedRoot: p.sealedRoot, publicTx: p.publicTx, sealedTx: p.sealedTx, signaturesArchived: p.signatures_archived ?? null, signatures0g: p.signatures_0g ?? null, signaturesVerified: sig?.verified ?? null } : null,
    // ERC-8004 adversary identity (docs/submission/CHECKLIST.md) shown only for anchored runs; no per-run Arkiv entity exists
    video: mediaUrl(`runs/${name}/screen.mp4`) ?? mediaUrl(`runs/${name}/chase_raw.mp4`),
    agentId: a ? 579 : null, arkivEntity: null, free: name.startsWith('demo-free-'), requestedBy: readJson(join(dir, 'requested_by.json'))?.requested_by ?? null,
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
const DECISION_FIELDS = ['cp', 'sim_time_s', 'wall_clock_utc', 'action', 'source', 'reason', 'request_id', 'provider', 'zg_res_key', 'latency_ms', 'http_status', 'content'] as const
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
  if (req.body?.job !== undefined) { await streamJob(String(req.body.job), send, res); return }
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

// ---------- Public demo: example policies, job queue (one CARLA job at a time), health, showcase, media ----------
const PY = resolve(ROOT, '.venv/bin/python')
const SITES: string[] = (() => { const d = readJson(resolve(ROOT, 'faultline/stack/sites_town10.json')); return (Array.isArray(d) ? d : d?.sites ?? []).map((x: any) => x.id) })()
const DEFAULT_SITE = SITES.includes('r7l-2s3') ? 'r7l-2s3' : SITES[0]
// Judges pick from these only; no code upload. CARLA runs the real stack (faultline/stack/world.py StackCutInWorld).
// The kinematic world has no CARLA sensors, so there the choice maps to the closest honest equivalent (`kinematic`).
const POLICIES = {
  'pdm-lite': { spec: 'stacks/pdm_lite.yaml', stem: 'pdm_lite', ego: 'default', name: 'PDM-Lite (LiDAR)',
    description: 'PDM-Lite planner on our LiDAR tracker (CARLA Leaderboard reference planner).',
    kinematic: 'Kinematic stand-in, not PDM-Lite: the kinematic world\'s exact-sensor IDM ego with its default numbers (1.2 s headway, 0.6 s reaction delay).' },
  'idm-cautious': { spec: 'stacks/idm_lidar.yaml', stem: 'idm_lidar', ego: 'cautious', name: 'Cautious IDM (1.6 s headway)',
    description: 'IDM car-following with 1.6 s headway and 3 m minimum gap over the same LiDAR tracks; PDM-Lite PID tracks its speed.',
    kinematic: 'Kinematic stand-in: the exact-sensor IDM ego with this stack\'s numbers (1.6 s headway, 3 m min gap, no reaction delay).' },
} as const
type PolicyId = keyof typeof POLICIES
const isPolicy = (p: unknown): p is PolicyId => typeof p === 'string' && Object.hasOwn(POLICIES, p)
const policyChecks = new Map<string, { ok: boolean, digest: string | null, name: string, rows: string[][] } | { error: string }>()
const CHECK_PY = 'import json,sys;from faultline.stack.check import check;r=check(sys.argv[1],40);print(json.dumps({"ok":r["ok"],"digest":r["digest"],"name":r["name"],"rows":[[str(c) for c in x] for x in r["rows"]]}))'
function checkPolicies() {
  for (const [id, p] of Object.entries(POLICIES)) {
    const c = spawn(PY, ['-c', CHECK_PY, p.spec], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''; c.stdout!.on('data', (b) => { out += b })
    c.on('exit', () => { try { policyChecks.set(id, JSON.parse(out.trim().split('\n').pop()!)) } catch { policyChecks.set(id, { error: 'check failed' }) } })
  }
}

type Job = { id: string, kind: 'demo' | 'arena', lane: 'carla' | 'kin', policy?: PolicyId, policies?: PolicyId[], suite?: string, site: string,
  seed: number, mode: 'free' | 'paid' | 'script', label: string, requestedBy?: string, status: 'queued' | 'running' | 'done' | 'error', error?: string,
  createdAt: number, startedAt?: number, finishedAt?: number, dirs: string[], events: unknown[], log: string[], result?: unknown }
const jobs = new Map<string, Job>()
const lanes = { carla: [] as Job[], kin: [] as Job[] } // index 0 = running
const MAX_WAITING = Number(process.env.FAULTLINE_QUEUE_MAX ?? 4)
const queuePos = (j: Job) => lanes[j.lane].indexOf(j) // 0 running, n = jobs ahead, -1 finished
// shortcut: fixed per-kind estimates (measured once: kinematic ~30 s, CARLA demo ~55 s); replace with a running average if needed
const estS = (j: Job) => (j.kind === 'arena' ? 240 : j.lane === 'carla' ? 90 : 40) + (j.mode === 'paid' ? 120 : 0)
const etaS = (j: Job) => { const i = queuePos(j); if (i < 0) return null; return lanes[j.lane].slice(0, i + 1).reduce((t, x) => t + (x.startedAt ? Math.max(5, estS(x) - (Date.now() - x.startedAt) / 1000) : estS(x)), 0) }
const arenaRows = (j: Job) => ((j.result as any)?.results ?? []).map((r: any, i: number) => ({ policy: j.policies?.[i] ?? r.stack, name: POLICIES[j.policies?.[i] as PolicyId]?.name ?? r.stack,
  drivingScore: r.driving_score ?? null, ccs: r.ccs_gt ?? null, minTtc: r.min_ttc_s ?? null, minGap: r.min_gap_m ?? null, collision: r.collision ?? null, routeCompletionPct: r.route_completion_pct ?? null }))
const jobVideo = (j: Job) => j.kind === 'arena' ? ((j.result as any)?.sideBySide ?? null) : j.dirs[0] && existsSync(join(j.dirs[0], 'screen.mp4')) ? relative(ROOT, join(j.dirs[0], 'screen.mp4')) : null
const jobPublic = (j: Job) => ({ id: j.id, kind: j.kind, lane: j.lane, policy: j.policy ?? null, policies: j.policies ?? null, suite: j.suite ?? null,
  site: j.site, seed: j.seed, mode: j.mode, label: j.label, status: j.status, error: j.error ?? null, queuePos: queuePos(j),
  requested_by: j.requestedBy ?? null, createdAt: j.createdAt, startedAt: j.startedAt ?? null, finishedAt: j.finishedAt ?? null, runs: j.dirs.map((d) => relative(RUNS, d)), result: j.result ?? null,
  etaS: j.status === 'queued' || j.status === 'running' ? Math.round(etaS(j) ?? 0) : null, results: j.kind === 'arena' ? arenaRows(j) : [], video: jobVideo(j) })
const deny = (res: Response, code: number, error: string) => { res.status(code).json({ error }) }

function enqueue(j: Job) {
  jobs.set(j.id, j); lanes[j.lane].push(j)
  if (lanes[j.lane].length === 1) void pump(j.lane)
}
async function pump(lane: 'carla' | 'kin') {
  const j = lanes[lane][0]
  if (!j) return
  j.status = 'running'; j.startedAt = Date.now()
  try { await runJob(j); if ((j.status as Job['status']) !== 'error') j.status = 'done' } catch (e) { j.status = 'error'; j.error = (e as Error).message }
  j.finishedAt = Date.now()
  appendLive(`job ${j.id} ${j.kind}/${j.mode}${j.requestedBy ? ` by ${j.requestedBy}` : ''} ${j.policy ?? j.policies?.join(',')} ${j.suite ?? ''} -> ${j.status}${j.error ? ` (${j.error})` : ''}`)
  lanes[lane].shift(); void pump(lane)
}
const appendLive = (m: string) => { try { appendFileSync(join(RUNS, 'agent-live.log'), `${new Date().toTimeString().slice(0, 8)} [backend-agent] ${m}\n`) } catch { /* log is best effort */ } }

function spawnPy(j: Job, args: string[]) {
  const env = { ...process.env }; delete env.npm_config_prefix
  const c = spawn(PY, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const on = (b: Buffer) => j.log.push(...b.toString().split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '')).filter((l) => l.trim()))
  c.stdout!.on('data', on); c.stderr!.on('data', on)
  return new Promise<number>((done) => { c.on('exit', (code) => done(code ?? 1)); c.on('error', () => done(1)) })
}
const summaryOf = (dir: string) => existsSync(join(dir, 'decisions.jsonl')) ? runSummary(relative(RUNS, dir)) : null

async function runJob(j: Job) {
  if (j.lane === 'carla' && !(await tcpOpen(2000))) throw new Error('CARLA is offline right now. Try the kinematic suite or replay a recorded run')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  let code: number
  if (j.kind === 'arena') {
    const out = join(RUNS, `arena-live-${stamp}`)
    j.dirs = j.policies!.map((p) => join(out, `${j.site}__${POLICIES[p].stem}`))
    code = await spawnPy(j, ['-m', 'faultline.stack.arena', '--site', j.site, '--stacks', j.policies!.map((p) => POLICIES[p].stem).join(','), '--mode', 'script', '--out', out])
    const cmp = readJson(join(out, 'compare.json'))
    j.result = cmp && { label: cmp.label, results: cmp.results, sideBySide: existsSync(join(out, `${j.site}__side_by_side.mp4`)) ? `runs/arena-live-${stamp}/${j.site}__side_by_side.mp4` : null }
  } else if (j.mode === 'free') {
    const p = POLICIES[j.policy!]
    if (j.suite === 'cut-in-v1-kinematic') {
      const out = join(RUNS, `demo-free-kin-${stamp}`); j.dirs = [out]
      code = await spawnPy(j, ['-m', 'faultline', 'run', '--world', 'kinematic', '--family', 'cut_in', '--decider', '0g', '--seed', String(j.seed), '--ego', p.ego, '--out', out])
    } else {
      const out = join(RUNS, `demo-free-carla-${stamp}`); j.dirs = [join(out, `${j.site}__${p.stem}`)]
      code = await spawnPy(j, ['-m', 'faultline.stack.arena', '--site', j.site, '--stacks', p.stem, '--mode', 'live', '--seed', String(j.seed), '--out', out])
    }
    j.result = summaryOf(j.dirs[0])
  } else { // paid: x402 on Hedera -> permit -> run-paid-job.ts (commit, run, publish, finalize)
    const a = await buy(buyerConfigFromEnv(), { suite: j.suite!, policyCommitment: policyCommitment() }, (s) => j.events.push({ t: 'step', ...s }))
    if ('quoteOnly' in a) throw new Error('unexpected quote-only result')
    bought.set(a.jobId, a)
    j.events.push({ t: 'phase', id: 'payment', status: 'ok', title: 'Payment settled on Hedera', data: { transaction: a.transaction, hashscan: hashscanTx(a.transaction) } })
    const r = await launchPaid(a)
    if (!('run' in r)) throw new Error(`${r.error} (paid job ${a.jobId} stays launchable from Order)`)
    j.events.push({ t: 'phase', id: 'permit', status: 'ok', title: 'Run permit accepted', data: { jobId: a.jobId } })
    j.dirs = [join(RUNS, r.run)]; j.log = r.entry.log
    while (r.entry.exit === null) await sleep(500)
    code = r.entry.exit
    j.result = summaryOf(j.dirs[0])
  }
  if (j.requestedBy && j.dirs[0] && existsSync(j.dirs[0])) writeFileSync(join(j.dirs[0], 'requested_by.json'), JSON.stringify({ requested_by: j.requestedBy, job: j.id, signed: 'EIP-191 personal_sign' }) + '\n')
  if (code !== 0) { j.status = 'error'; j.error = `runner exited ${code}` }
}

app.get('/api/health', async (_req, res) => {
  const hedera = await fetch(`http://127.0.0.1:${process.env.HEDERA_DEMO_PORT ?? '8787'}/.well-known/faultline-service.json`).then((r) => r.ok).catch(() => false)
  const running = lanes.carla.length ? 1 : 0, runningKin = lanes.kin.length ? 1 : 0
  res.json({ ok: true, carla: await tcpOpen(2000), zg: !!(process.env.ZG_ROUTER_URL && process.env.ZG_API_KEY), hedera,
    queue: { running: running + runningKin, waiting: Math.max(0, lanes.carla.length - 1) + Math.max(0, lanes.kin.length - 1) }, caps: caps.left() })
})

app.get('/api/policies', (_req, res) => {
  res.json(Object.entries(POLICIES).map(([id, p]) => {
    const c = policyChecks.get(id)
    return { id, name: p.name, description: p.description, spec: p.spec, kinematic: p.kinematic,
      digest: c && 'digest' in c ? c.digest : null, compatible: !!(c && 'ok' in c && c.ok), check: c ?? { pending: true },
      paid: id === 'pdm-lite' } // paid permits bind the PDM-Lite policy commitment (run-paid-job.ts)
  }))
})

app.post('/api/demo-run', async (req, res) => {
  const { policy, suite, mode } = req.body ?? {}
  if (!isPolicy(policy)) return deny(res, 400, 'policy must be one of: ' + Object.keys(POLICIES).join(', '))
  if (!Object.hasOwn(SUITES, suite)) return deny(res, 400, 'suite must be cut-in-v1-kinematic or cut-in-v1-carla')
  if (mode !== 'free' && mode !== 'paid') return deny(res, 400, 'mode must be free or paid')
  const seed = req.body?.seed === undefined ? Math.floor(Math.random() * 1000) : Number(req.body.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 100000) return deny(res, 400, 'seed must be an integer 0..100000')
  if (!process.env.ZG_ROUTER_URL || !process.env.ZG_API_KEY) return deny(res, 503, '0G Router is not configured on the backend')
  if (mode === 'paid') {
    if (policy !== 'pdm-lite') return deny(res, 400, 'paid runs are bound to the PDM-Lite policy commitment; use mode free for other policies')
    const notReady = runnerError(); if (notReady) return deny(res, 503, `runner not ready, nothing was paid: ${notReady}`)
    try { buyerConfigFromEnv() } catch (e) { return deny(res, 503, (e as Error).message) }
  }
  const lane = suite === 'cut-in-v1-carla' ? 'carla' : 'kin'
  if (lanes[lane].length > MAX_WAITING) return deny(res, 429, 'The queue is full. Try again in a few minutes or replay a recorded run')
  if (caps.left().runs_left < 1 || (mode === 'paid' && caps.left().buys_left < 1)) return deny(res, 429, PAUSED)
  const visitor = typeof req.body?.address === 'string' ? req.body.address.toLowerCase() : `ip:${guestKey(req)}`
  const prev = recentStart.get(visitor), pj = prev && Date.now() - prev.at < 30_000 ? jobs.get(prev.jobId) : undefined
  if (pj) { res.json({ jobId: pj.id, queuePos: queuePos(pj), label: pj.label, duplicate: true }); return }
  let v: { address: string } | { error: string }
  if (req.body?.guest === true && !req.body?.signature) {
    if (mode !== 'free') return deny(res, 401, 'Paid runs need a signed wallet request. Connect a wallet, or use a free guest run')
    // behind the Vercel proxy, key on the visitor, not Vercel
    if (!guestPerIp.allow(guestKey(req))) return deny(res, 429, 'Guest run limit reached for your network this hour. Connect a wallet for more, or replay a recorded test')
    if (!guestDaily.take('guest')) return deny(res, 429, 'Guest runs are used up for today. Connect a wallet, or replay a recorded test')
    v = { address: 'guest run' }
  } else {
    v = await verifyRunRequest(req.body, { policy, suite, mode }, nonces, verifyMessage)
    if ('error' in v) return deny(res, 401, v.error)
    if (!walletCaps.take(v.address)) return deny(res, 429, 'This wallet has used its live runs for today. Replay a recorded run')
  }
  if (mode === 'paid' && !caps.take('buys')) return deny(res, 429, PAUSED)
  caps.take('runs')
  const j: Job = { id: randomBytes(8).toString('hex'), kind: 'demo', lane, policy, suite, site: DEFAULT_SITE, seed, mode, status: 'queued', requestedBy: v.address,
    label: mode === 'free' ? 'demo, unpaid, not anchored' : 'paid: Hedera x402, anchored on 0G Galileo',
    createdAt: Date.now(), dirs: [], events: [], log: [] }
  enqueue(j); recentStart.set(visitor, { jobId: j.id, at: Date.now() })
  res.json({ jobId: j.id, queuePos: queuePos(j), label: j.label, kinematicNote: lane === 'kin' ? POLICIES[policy].kinematic : null })
})

app.post('/api/arena', (req, res) => {
  const pol = req.body?.policies ?? ['pdm-lite', 'idm-cautious']
  if (!Array.isArray(pol) || pol.length < 1 || pol.length > 2 || !pol.every(isPolicy) || new Set(pol).size !== pol.length) return deny(res, 400, 'policies: one or two of ' + Object.keys(POLICIES).join(', '))
  const site = req.body?.site ?? DEFAULT_SITE
  if (!SITES.includes(site)) return deny(res, 400, 'site must be one of: ' + SITES.join(', '))
  if ((req.body?.mode ?? 'script') !== 'script') return deny(res, 400, 'only mode script (replayed adversary, no 0G cost) is public')
  if (lanes.carla.length > MAX_WAITING) return deny(res, 429, 'The queue is full. Try again in a few minutes or replay a recorded run')
  const j: Job = { id: randomBytes(8).toString('hex'), kind: 'arena', lane: 'carla', policies: pol, site, seed: 0, mode: 'script', status: 'queued',
    label: 'A/B arena: identical adversary script replayed from runs/cutin-002 (no 0G calls)', createdAt: Date.now(), dirs: [], events: [], log: [] }
  enqueue(j)
  res.json({ jobId: j.id, queuePos: queuePos(j), label: j.label })
})

// Live CARLA chase camera as MJPEG: SimClockRecorder keeps runs/<run>/live.jpg current (atomic writes) while a job runs.
app.get('/api/live/:id', async (req, res) => {
  const j = jobs.get(req.params.id)
  if (!j) return deny(res, 404, 'unknown job')
  res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
  let closed = false, last = 0; res.on('close', () => { closed = true })
  const until = Date.now() + 20 * 60_000
  while (!closed && Date.now() < until) {
    const dir = j.dirs.filter((d) => existsSync(join(d, 'live.jpg'))).at(-1)
    if (dir) {
      try {
        const p = join(dir, 'live.jpg'), m = statSync(p).mtimeMs
        if (m !== last) { last = m; const b = readFileSync(p); res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${b.length}\r\n\r\n`); res.write(b); res.write('\r\n') }
      } catch { /* frame being replaced: next poll */ }
    }
    if (j.status === 'done' || j.status === 'error') break
    await sleep(100)
  }
  res.end()
})

app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id)
  if (!j) return deny(res, 404, 'unknown job')
  res.json(jobPublic(j))
})

async function streamJob(id: string, send: (o: unknown) => void, res: Response) {
  const j = jobs.get(id)
  if (!j) { send({ t: 'error', message: 'unknown job' }); res.end(); return }
  let closed = false; res.on('close', () => { closed = true })
  send({ t: 'meta', job: jobPublic(j), mode: 'live' })
  let ei = 0, li = 0, lastPos = -2, di = -1, dec: Tail | null = null, traj: Tail | null = null
  const flush = () => {
    for (; ei < j.events.length; ei++) send(j.events[ei])
    for (; li < j.log.length; li++) send({ t: 'log', line: j.log[li] })
    const cur = j.dirs.reduce((k, d, i) => (existsSync(d) ? i : k), -1)
    if (cur !== di && cur >= 0) {
      if (dec) { for (const d of dec.lines()) send({ t: 'decision', d: pick(d, DECISION_FIELDS) }); const r = traj!.lines(); if (r.length) send({ t: 'ticks', rows: r.map((x) => pick(x, TICK_FIELDS)) }) }
      di = cur; dec = new Tail(join(j.dirs[cur], 'decisions.jsonl')); traj = new Tail(join(j.dirs[cur], 'trajectory.jsonl'))
      send({ t: 'phase', id: 'sim', status: 'run', title: j.policies ? `Simulation: ${j.policies[cur]}` : 'Simulation running', data: { run: relative(RUNS, j.dirs[cur]), index: cur } })
    }
    if (dec) for (const d of dec.lines()) send({ t: 'decision', d: pick(d, DECISION_FIELDS) })
    if (traj) { const r = traj.lines(); if (r.length) send({ t: 'ticks', rows: r.map((x) => pick(x, TICK_FIELDS)) }) }
  }
  while (!closed) {
    const pos = queuePos(j)
    if (j.status === 'queued' && pos !== lastPos) { lastPos = pos; send({ t: 'queue', pos, etaS: Math.round(etaS(j) ?? 0) }) }
    try { flush() } catch { /* a half-written line: next poll */ }
    if (j.status === 'done' || j.status === 'error') {
      try { flush() } catch { /* ignore */ }
      send(j.status === 'done' ? { t: 'done', job: jobPublic(j) } : { t: 'error', message: j.error, job: jobPublic(j) })
      break
    }
    await sleep(250)
  }
  res.end()
}

// Curated evidence, read from run dirs at request time (cached 60 s). Facts not on disk come from the cited docs.
const tx = (h?: string | null) => (h ? `https://chainscan-galileo.0g.ai/tx/${h}` : null)
const stx = (h?: string | null) => (h ? `https://storagescan-galileo.0g.ai/tx/${h}` : null)
const mediaUrl = (rel: string) => (existsSync(join(ROOT, rel)) ? rel : null) // the page requests /media/<this>
const jsonl = (p: string) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
function anchored(run: string) {
  const a = readJson(join(RUNS, run, 'anchor.json')), p = readJson(join(RUNS, run, 'publish.json')), met = readJson(join(RUNS, run, 'metrics.json'))
  if (!a && !p) return null
  return { run, publicRoot: p?.publicRoot ?? null, sealedRoot: p?.sealedRoot ?? null, publicTx: p?.publicTx ?? null, publicTxUrl: stx(p?.publicTx),
    signatures: p ? `${p.signatures_archived ?? '?'}` : null, commitTx: a?.commitTx ?? null, commitUrl: tx(a?.commitTx), finalizeTx: a?.finalizeTx ?? null,
    finalizeUrl: tx(a?.finalizeTx), onchainMatches: a?.onchainMatches ?? null, registry: a?.registry ?? null,
    metrics: met ? { ccs: met.ccs ?? null, minTtc: met.min_ttc_s ?? null, minGap: met.min_gap_m ?? null, collision: met.collision ?? null } : null,
    video: mediaUrl(`videos/${run}__chase.mp4`) ?? mediaUrl(`runs/${run}/screen.mp4`) }
}
function swarm(run: string) {
  const m = readJson(join(RUNS, run, 'manifest.json')), plan = readJson(join(RUNS, run, 'plan.json')), sig = readJson(join(RUNS, run, 'decisions.jsonl.sigs.json'))
  if (!m) return null
  return { run, title: plan?.plan?.name ?? m.plan_name, status: m.status, collision: m.collision, decisions0g: m.decisions_0g,
    plan: plan?.plan ?? null, planRequestId: m.plan_request_id ?? plan?.request_id ?? null, provider: plan?.provider ?? null,
    decisions: jsonl(join(RUNS, run, 'decisions.jsonl')).slice(0, 12).map((d) => ({ cp: d.cp, action: d.action, source: d.source, request_id: d.request_id, sim_time_s: d.sim_time_s })),
    signatures: sig ? { total: sig.total, verified: sig.verified } : null,
    video: mediaUrl(`runs/${run}/stitched.mp4`) ?? mediaUrl(`videos/${run}__stitched.mp4`),
    director: mediaUrl(`runs/${run}/director.mp4`) ?? mediaUrl(`videos/${run}__director.mp4`), decisionsHtml: mediaUrl(`runs/${run}/decisions.html`) }
}
let showcaseCache: { at: number, body: unknown } | null = null
function showcase() {
  if (showcaseCache && Date.now() - showcaseCache.at < 60_000) return showcaseCache.body
  const arena = readJson(join(RUNS, 'arena-script-001', 'compare.json'))
  const hunt = readJson(join(RUNS, 'hunt-bench-002', 'hunt.json'))
  const report = (() => { try { return readFileSync(join(RUNS, 'research-mission-001', 'report.md'), 'utf8').slice(0, 1800) } catch { return null } })()
  const paid002 = readdirSync(RUNS).find((n) => n.startsWith('paid-de2d56fd2f3cd49fb30c1a7633f9d8c1-') && !n.includes('replay'))
  const body = {
    contracts: { chain: '0G Galileo 16602', episodeRegistryV2: '0xeE2260cE4835059F0e0f1FB9C9948Ca5a7d4b5A4', agentMemoryRegistry: '0x7a8676D267f1aa17d6B55cF5BfcD2A9509b963e3',
      erc8004: { registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e', agentId: 579 }, source: 'docs/submission/CHECKLIST.md' },
    swarm: ['swarm-carla-008', 'swarm-carla-010'].map(swarm).filter(Boolean),
    arena: arena && { run: 'arena-script-001', label: arena.label, results: arena.results.filter((r: any) => r.site === 'r7l-2s3'),
      sites: [...new Set(arena.results.map((r: any) => r.site))].map((s) => ({ site: s, sideBySide: mediaUrl(`runs/arena-script-001/${s}__side_by_side.mp4`) ?? mediaUrl(`videos/arena-script-001__${s}__side_by_side.mp4`) })) },
    research: { run: 'research-mission-001', reportExcerpt: report, videos: ['carla-failure', 'carla-fix-baseline', 'carla-fix-0g'].map((v) => mediaUrl(`videos/research-mission-001__${v}.mp4`)), source: 'docs/evidence/faultline-research.md' },
    hunt: hunt && { run: 'hunt-bench-002', goal: hunt.goal, ground_truth: hunt.ground_truth, scores: hunt.scores, safety_definition: hunt.safety_definition,
      boundary: mediaUrl('runs/hunt-bench-002/boundary.svg'), videos: [mediaUrl('videos/hunt-bench-002__carla-unsafe.mp4'), mediaUrl('videos/hunt-bench-002__carla-safe.mp4')] },
    memory: { source: 'docs/evidence/faultline-memory.md', registry: '0x7a8676D267f1aa17d6B55cF5BfcD2A9509b963e3',
      table: [{ category: 'low_friction', n: 11, collisionsV10: 5, collisionsV11: 1 }, { category: 'slow_reaction', n: 27, collisionsV10: 9, collisionsV11: 2 },
        { category: 'hard_brake', n: 30, collisionsV10: 6, collisionsV11: 0 }, { category: 'lead_brake', n: 67, collisionsV10: 9, collisionsV11: 0 },
        { category: 'overall', n: 135, collisionsV10: 29, collisionsV11: 3, regressions: 0 }],
      anchors: [{ snapshot: 'idm-follower@1.0#1', tx: '0x0281c6a1012c721e989a8d569d809849eda9ddbfa067137d975a40f6965688e5', publicRoot: '0x08c592a1b87d622067c0964ae15d9ed9665e5868704fec9e142bf91606035d9e' },
        { snapshot: 'idm-follower@1.1#2', tx: '0x9a7265d1e1aa58f554bff0b92b7c871db34cc59a1875ceb86b2fe0693077b084', publicRoot: '0x0ff260127d38daecf4debacdd03dbf0df239b42ea5285502bc6e97f8d716ed4b' }].map((a) => ({ ...a, url: tx(a.tx) })),
      arkiv: { network: 'Rabdi 7794095', schema: 'faultline.claim/v1', entities: [
        ['1.0', 'low_friction', '0x0c86b3013723186cd72b15847256b349c37df3c0656427eb4f8abcfa40798db8'], ['1.0', 'slow_reaction', '0xac771ae307ab2f600f90c6050244665c6e4cc94382b7aa7fed96e5a717e88f0e'],
        ['1.0', 'hard_brake', '0x387e2bb62a97d77cf96f5f1b8eaa033a63cafe494e743515ed4857f288e7fa50'], ['1.0', 'lead_brake', '0x259ec53429995025292a6e53bf18ece655f93eb3ffe85c263e2f36314c3d692a'],
        ['1.1', 'low_friction', '0x3bdcf0a7b97a807aa5e9dd2c74c8fff6be26b6c2153610973cc61c7ed7e59727'], ['1.1', 'slow_reaction', '0xb1271d9ee72a20e99d630e36fa794cbd7d1f1082f40db07f22145fd7e39f30e3'],
        ['1.1', 'hard_brake', '0x0da7962d2180689ec7e2f0682b213dae95c33b1a02f83ea2c191d95afd7ec3b5'], ['1.1', 'lead_brake', '0x63990b662ebd9c39cda12bf0e550e9e03302462022b8e9bdfef7fea374f89dcd']].map(([version, category, key]) => ({ version, category, key })) } },
    episodes: {
      demo003: anchored('demo-003'), cutin002: anchored('cutin-002'),
      paidJob002: { source: 'docs/evidence/faultline-paid-job-002-carla.md', hedera: '0.0.9185802@1794006563.434123686', hashscan: hashscanTx('0.0.9185802@1794006563.434123686'),
        commitTx: '0x512ead9bd41cbf78313df571195226533d7bfaaeec02501b7c8e2f7f39643372', commitUrl: tx('0x512ead9bd41cbf78313df571195226533d7bfaaeec02501b7c8e2f7f39643372'),
        publicRoot: '0xc1219e48d517edabbea12db2bddf21294bcd5ddb106b00d963d8837cb75f6748', publicTx: '0x5b9adb9f695a1b39ef2b53e14de5fe24c87ecaf0ef4066f5acc96b54363d3f4f', publicTxUrl: stx('0x5b9adb9f695a1b39ef2b53e14de5fe24c87ecaf0ef4066f5acc96b54363d3f4f'),
        finalizeTx: '0x1ece91e630a9dcdcd326515b57934e02c0c1c5e84e339020fe0a6819e3f7f7ab', finalizeUrl: tx('0x1ece91e630a9dcdcd326515b57934e02c0c1c5e84e339020fe0a6819e3f7f7ab'),
        run: paid002 ?? null, video: paid002 ? mediaUrl(`runs/${paid002}/screen.mp4`) : null },
    },
  }
  const sw = body.swarm.find((x: any) => x.run === 'swarm-carla-010') as any, p2 = body.episodes.paidJob002
  const ARKIV = 'https://rabdi.explorer.arkiv.network' // entity URL format not confirmed (SPA answers every path), so base only
  const items = [
    sw && { id: 'swarm', plan: sw.plan ? { name: sw.plan.name, summary: sw.plan.summary, roles: sw.plan.roles, phases: sw.plan.phases } : null, video: sw.video ?? mediaUrl('videos/swarm-carla-010__stitched.mp4'), trust: { decisions0g: sw.decisions0g, requestId: sw.planRequestId, provider: sw.provider,
      sigsVerified: sw.signatures?.verified ?? null, sigsTotal: sw.signatures?.total ?? null }, links: { decisionsHtml: sw.decisionsHtml, director: sw.director } },
    body.arena && { id: 'arena', video: body.arena.sites.find((x: any) => x.site === 'r4l2s24')?.sideBySide ?? null, trust: { note: 'replayed adversary script (cutin-002) · no 0G calls' } },
    { id: 'research', video: mediaUrl('videos/research-mission-001__carla-failure.mp4'), trust: {} },
    { id: 'memory', trust: { arkiv: '0x63990b662ebd9c39cda12bf0e550e9e03302462022b8e9bdfef7fea374f89dcd' }, links: { arkivExplorer: ARKIV, anchorV11: tx('0x9a7265d1e1aa58f554bff0b92b7c871db34cc59a1875ceb86b2fe0693077b084') } },
    { id: 'paid002', video: p2.video, trust: { publicRoot: p2.publicRoot, commitTx: p2.commitTx, finalizeTx: p2.finalizeTx,
      hedera: { transaction: p2.hedera, hashscan: p2.hashscan } }, links: { commit: p2.commitUrl, finalize: p2.finalizeUrl, storage: p2.publicTxUrl, hashscan: p2.hashscan } },
  ].filter(Boolean)
  Object.assign(body, { items, arkivExplorer: ARKIV })
  showcaseCache = { at: Date.now(), body }
  return body
}
app.get('/api/showcase', (_req, res) => { res.json(showcase()) })

app.use('/media', (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).end(); return }
  let rel = ''; try { rel = decodeURIComponent(req.path.slice(1)) } catch { /* bad escape -> 404 */ }
  const abs = mediaPath(ROOT, rel)
  if (!abs) { res.status(404).end(); return }
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.sendFile(abs, { dotfiles: 'deny', acceptRanges: true })
})

checkPolicies()

app.listen(PORT, '127.0.0.1', () => console.log(`Faultline Studio on http://127.0.0.1:${PORT}  (agent console; payer key stays here)`))
