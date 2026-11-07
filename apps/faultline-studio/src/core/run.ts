// One run, live or recorded: POST /api/stream ({job, mode:'live'} for a 16-hex job id, else {run, mode:'replay'}), plus run naming and the sibling tabs.
import { FEATURED, SWARM, href } from '../routes'
import { stream, type Decision, type Job, type Plan, type Run, type Tick } from './api'
import { esc } from './dom'
import { lastJob } from './state'
import { SWARM_SUITE } from './catalogue'

export const BUNDLED_NOTE = 'The runner is offline, so this is the copy of the recorded run bundled with this site.'
export const isJob = (id: string) => /^[0-9a-f]{16}$/.test(id)

// Recorded camera for runs whose own folder has none (paid test 002 was replayed in CARLA from its decisions; same trajectory)
export const RUN_VIDEO: Record<string, { path: string, aligned: boolean, note?: string }> = {
  [FEATURED]: { path: 'runs/paid-job-002-replay-view/screen.mp4', aligned: true, note: 'Camera from an exact CARLA replay of this paid run (same decisions, same trajectory hash).' },
}
const DIRECTOR_NOTE = 'Director cut with the 0G decision cards inserted, so it is not time-aligned with the timeline.'
export const videoOf = (name: string, r: Run | null) => RUN_VIDEO[name] ?? (r?.video ? (r.video.endsWith('director.mp4') ? { path: r.video, aligned: false, note: DIRECTOR_NOTE } : { path: r.video, aligned: true }) : null)
export const runTitle = (id: string, swarm = false) => id === FEATURED ? 'Paid test 002' : id === SWARM ? 'Coordinated four-car attack · swarm-carla-010' : swarm ? `Coordinated four-car attack · ${id}` : isJob(id) ? `Your run ${id.slice(0, 8)}` : id
const WHY_SAY: Record<string, string> = {
  CUT_IN_AGGRESSIVE: 'Cut sharply into your lane', CUT_IN: 'Cut into your lane', BRAKE_HARD: 'Brake hard in front of you', BRAKE_SOFT: 'Brake gently',
  SLOW_DOWN: 'Slow down', ACCELERATE: 'Speed up', MAINTAIN: 'Hold speed and lane', KEEP_LANE: 'Stay in its lane', COAST: 'Coast', SAFE_HALT: 'Stop safely (no valid answer from 0G)',
}
/** Plain words for an attacker action. */
export const say = (a: string | null) => WHY_SAY[a ?? 'SAFE_HALT'] ?? String(a).replace(/_/g, ' ').toLowerCase()
/** The model's one-line reason, when the decision content carries one. */
export const why = (d: Decision) => { try { return String(JSON.parse(d.content ?? '').why ?? '') } catch { return '' } }
/** Outcome sentence (content rules: never "safe"). */
export const outcome = (r: Run | null) => (r?.collision == null ? null : r.collision ? 'Collision occurred in this test' : 'Avoided collision in this test')

/** Sibling links for one run; the active one carries aria-current. */
export const runTabs = (id: string, active: 'mission' | 'results' | 'verify') =>
  `<nav class="runtabs" aria-label="This run">${([['mission', 'Mission', href.mission(id)], ['results', 'Results', href.results(id)], ['verify', 'Proof', href.verify(id)]] as const)
    .map(([k, t, u]) => `<a href="${esc(u)}"${k === active ? ' aria-current="page" class="on"' : ''}>${t}</a>`).join('')}</nav>`

export type RunState = 'Ready' | 'Waiting for 0G' | 'Executing' | 'Completed' | 'Safe halt' | 'Interrupted' | 'Unknown'
export type LoadedRun = { id: string, live: boolean, swarm: boolean, run: Run | null, job: Job | null, ticks: Tick[], ds: Decision[], plan: Plan | null
  state: RunState, queue: { pos: number, etaS: number | null } | null, note: string, done: boolean
  /** true when the run did not complete (safe halt, error, interrupted status); reason says why in plain words */
  interrupted: boolean, reason: string | null, notFound: boolean
  /** the console was unreachable, so this is the copy of a featured run bundled with the site */
  bundled: boolean }

/**
 * Stream a run: onEvent gets every NDJSON event plus the updated snapshot. Resolves when the stream ends, errors or is aborted
 * (aborted: done stays false). An unknown live job (console restarted) resolves with notFound and state 'Unknown'.
 */
export async function loadRun(id: string, onEvent?: (e: any, s: LoadedRun) => void, signal?: AbortSignal): Promise<LoadedRun> {
  const live = isJob(id)
  const s: LoadedRun = { id, live, swarm: id === SWARM, run: null, job: null, ticks: [], ds: [], plan: null, state: 'Ready', queue: null, note: '', done: false,
    interrupted: false, reason: null, notFound: false, bundled: false }
  let errMsg: string | null = null
  try {
    await stream('/api/stream', live ? { job: id, mode: 'live' } : { run: id, mode: 'replay', speed: 8 }, (e) => {
      if (e.t === 'meta') { s.job = e.job ?? null; s.run = e.run ?? e.job?.result ?? null; if (e.job?.suite === SWARM_SUITE || s.run?.family === 'swarm') s.swarm = true
        if (e.bundled) { s.bundled = true; s.note = BUNDLED_NOTE } }
      else if (e.t === 'plan') s.plan = e.plan
      else if (e.t === 'queue') { s.queue = { pos: e.pos, etaS: e.etaS ?? null }; s.note = e.pos > 0 ? `Queued: position ${e.pos}${e.etaS != null ? `, about ${Math.round(e.etaS)} s` : ''}` : 'Started' }
      else if (e.t === 'phase' && e.id === 'sim' && s.state === 'Ready') s.state = 'Waiting for 0G'
      else if (e.t === 'await0g') { if (s.state !== 'Safe halt') s.state = 'Waiting for 0G' }
      else if (e.t === 'ticks') { s.ticks.push(...e.rows); if (s.state === 'Ready' || s.state === 'Waiting for 0G') s.state = 'Executing' }
      else if (e.t === 'decision') { s.ds.push(e.d); if (e.d.source !== '0g') s.state = 'Safe halt'; else if (s.state !== 'Safe halt') s.state = 'Executing' }
      else if (e.t === 'done' || e.t === 'error') {
        s.job = e.job ?? s.job; s.run = e.run ?? e.job?.result ?? s.run
        if (e.t === 'error') errMsg = String(e.message ?? 'error')
      }
      onEvent?.(e, s)
    }, signal)
  } catch (err) {
    if ((err as Error).name === 'AbortError' || signal?.aborted) return s
    errMsg = (err as Error).message
  }
  if (errMsg && /^unknown (job|run)$/.test(errMsg) && !s.run) {
    s.notFound = true; s.state = 'Unknown'
    s.note = live ? 'This live job is no longer on the runner.' : 'No recorded run has this name.'
    s.done = true
    return s
  }
  s.done = true
  const halt = s.ds.find((d) => d.source !== '0g')
  s.state = errMsg ? 'Interrupted' : halt || s.state === 'Safe halt' ? 'Safe halt' : s.ds.length ? 'Completed' : 'Interrupted'
  if (s.run?.status === 'interrupted' && s.state === 'Completed') s.state = 'Interrupted'
  s.interrupted = s.state !== 'Completed'
  s.reason = !s.interrupted ? null : errMsg ? `Stopped: ${errMsg}`
    : halt ? `No valid answer from 0G at checkpoint ${halt.cp + 1}, so the attacker stopped safely${halt.reason ? ` (${halt.reason})` : ''}.`
    : s.run?.status === 'interrupted' ? 'The run record marks this episode interrupted.' : s.ds.length ? 'The run did not complete.' : 'The run ended before any decision.'
  if (errMsg) s.note = `Stopped: ${errMsg}`
  // a finished live job becomes its run name, so its link survives console restarts
  const lj = lastJob.get()
  if (live && s.run?.name && lj?.jobId === id && lj.runName !== s.run.name) lastJob.set({ ...lj, runName: s.run.name })
  return s
}
