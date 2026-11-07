// Regenerates the committed replay fixtures from real run directories, mirroring the console's replay stream
// (packages/hedera/src/agent-console.ts: runSummary, DECISION_FIELDS, TICK_FIELDS, planEvent, POST /api/stream replay) minus the pacing.
// node apps/faultline-studio/test/fixtures/make.mjs   (from the repo root; needs runs/halt-001 and runs/swarm-carla-010)
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../../../../', import.meta.url).pathname, RUNS = join(ROOT, 'runs')
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]))
const DECISION_FIELDS = ['cp', 'sim_time_s', 'wall_clock_utc', 'action', 'source', 'reason', 'request_id', 'provider', 'zg_res_key', 'latency_ms', 'http_status', 'content', 'phase']
const TICK_FIELDS = ['t_s', 'ego_x', 'ego_v', 'ego_a', 'ego_lat_m', 'lead_x', 'lead_v', 'adv_lat_m', 'gt_gap', 'gt_ttc_s', 'ttc_s', 'lidar_gap', 'ccs', 'collision', 'gt_in_path', 'cars']
const mediaUrl = (rel) => (existsSync(join(ROOT, rel)) ? rel : null)

function runSummary(name) {
  const dir = join(RUNS, name)
  const m = readJson(join(dir, 'manifest.json')), a = readJson(join(dir, 'anchor.json')), p = readJson(join(dir, 'publish.json'))
  const met = readJson(join(dir, 'metrics.json')), sig = readJson(join(dir, 'decisions.jsonl.sigs.json'))
  return {
    name, jobId: null, status: m?.preliminary ? 'running' : m?.status ?? 'running', world: m?.world ?? null, family: m?.family ?? null,
    episodeId: m?.episode_id ?? null, model: m?.model ?? null, decisions: m?.decisions_total ?? null, decisions0g: m?.decisions_0g ?? null,
    ccs: met?.ccs ?? null, minTtc: met?.min_ttc_s ?? met?.ground_truth?.min_ttc_s ?? null, minGap: met?.min_gap_m ?? met?.ground_truth?.min_gap_in_path_m ?? null, collision: met?.collision ?? null,
    startedAt: m?.started_at ?? null, finishedAt: m?.finished_at ?? null, mtime: Math.round(statSync(dir).mtimeMs),
    chain: a ? { registry: a.registry, commitTx: a.commitTx, commitBlockTimestamp: a.commitBlockTimestamp, finalizeTx: a.finalizeTx ?? null, onchainMatches: a.onchainMatches ?? null } : null,
    storage: p ? { publicRoot: p.publicRoot, sealedRoot: p.sealedRoot, publicTx: p.publicTx, sealedTx: p.sealedTx, signaturesArchived: p.signatures_archived ?? null, signatures0g: p.signatures_0g ?? null, signaturesVerified: sig?.verified ?? null } : null,
    video: mediaUrl(`runs/${name}/screen.mp4`) ?? mediaUrl(`runs/${name}/chase_raw.mp4`) ?? mediaUrl(`runs/${name}/director.mp4`),
    agentId: a ? 579 : null, arkivEntity: null, free: name.startsWith('demo-free-'), requestedBy: readJson(join(dir, 'requested_by.json'))?.requested_by ?? null, payment: null,
  }
}

function replay(name) {
  const dir = join(RUNS, name), s = runSummary(name), out = []
  const decisions = jsonl(join(dir, 'decisions.jsonl')).map((d) => pick(d, DECISION_FIELDS)), ticks = jsonl(join(dir, 'trajectory.jsonl')).map((t) => pick(t, TICK_FIELDS))
  const phase = (id, status, title, data) => out.push({ t: 'phase', id, status, title, data })
  out.push({ t: 'meta', run: s, totalTicks: ticks.length, totalDecisions: decisions.length, mode: 'replay' })
  const p = readJson(join(dir, 'plan.json'))
  if (p?.plan) out.push({ t: 'plan', plan: { name: p.plan.name, summary: p.plan.summary, roles: p.plan.roles, phases: p.plan.phases }, requestId: p.request_id ?? null, source: p.source ?? null })
  if (s.chain) phase('commit', 'ok', 'Scenario committed on 0G Galileo', { tx: s.chain.commitTx })
  phase('sim', 'run', `Simulation on ${s.world}`)
  let di = 0
  for (const tick of ticks) {
    while (di < decisions.length && decisions[di].sim_time_s <= tick.t_s + 1e-9) { out.push({ t: 'await0g', cp: decisions[di].cp }); out.push({ t: 'decision', d: decisions[di++] }) }
    out.push({ t: 'ticks', rows: [tick] })
  }
  phase('sim', 'ok', `Simulation on ${s.world}`, { ticks: ticks.length })
  if (s.storage) phase('storage', 'ok', 'Evidence on 0G Storage', s.storage)
  if (s.chain?.finalizeTx) phase('finalize', 'ok', 'Result finalized on 0G Galileo', { tx: s.chain.finalizeTx, onchainMatches: s.chain.onchainMatches })
  out.push({ t: 'done', run: s })
  return out.map((e) => JSON.stringify(e)).join('\n') + '\n'
}

for (const [run, file] of [['halt-001', 'safe-halt.ndjson'], ['swarm-carla-010', 'swarm-010.ndjson']]) {
  writeFileSync(new URL(`./${file}`, import.meta.url), replay(run)); console.log(`wrote ${file} from runs/${run}`)
}
