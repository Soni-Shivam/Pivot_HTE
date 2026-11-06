// Bit-exact browser replay of the lead-brake family (audit B2): a port of faultline/world.py KinematicWorld,
// faultline/controller.py IdmFollower + LeadLongitudinal and the lead-brake branch of the checkpoint loop in
// faultline/episode.py run_episode. Only + - * / min max sqrt, so doubles match Python bit for bit; min/max follow
// Python's argument order (signed zeros), and rounding follows Python round(x, 6). Browser-safe, no imports.
// Inputs: the revealed scenario.json and each public decision's control_decel_mps2 / source.

const G = 9.81
const HALF_LENS_M = (4.9 + 4.7) / 2
const IDM = { desired_speed_mps: 20.0, time_headway_s: 1.2, min_gap_m: 2.0, max_accel_mps2: 1.5, comfort_decel_mps2: 3.0, reaction_delay_s: 0.6 }
const SAFE_HALT_STOP = { HALT_MAX_S: 8.0, STOPPED_V: 0.3, STOPPED_HOLD_S: 2.0 }
const pyMax = (a: number, b: number) => (b > a ? b : a)
const pyMin = (a: number, b: number) => (b < a ? b : a)

/** Python round(x, 6): correctly rounded with ties to even. toFixed is correctly rounded with ties away from zero, so
 *  only an exact tie (binary value with exactly 7 decimals ending in 5) needs fixing. */
export function round6(x: number): number {
  if (x === 0) return x // keeps -0.0, which Python prints as -0.0
  const s = Math.abs(x).toFixed(30)
  const i = s.indexOf('.') + 7
  if (s[i] === '5' && /^0*$/.test(s.slice(i + 1))) {
    const down = Number(s.slice(0, i)), up = Number(Math.abs(x).toFixed(6))
    const even = Number(s[i - 1]) % 2 === 0 ? down : up
    return x < 0 ? -even : even
  }
  return Number(x.toFixed(6))
}

export type Scenario = { family: string; ego_speed_mps: number; lead_speed_mps: number; initial_gap_m: number; friction_mu: number
  horizon_s: number; checkpoint_s: number; runup_s: number; dt_s: number }
export type ReplayDecision = { control_decel_mps2: number | null; source: string }
export type Row = { t_s: number; ego_x: number; ego_v: number; ego_a: number; lead_x: number; lead_v: number; lead_a: number
  gt_gap: number; lidar_gap: number | null; lidar_closing: number | null; collision: boolean }

/** Re-run one lead-brake episode. `collisionFrom` (CARLA runs): the published collision flags, because CARLA's
 *  collision sensor is an input the kinematic model does not have; kinematic runs pass nothing. */
export function replayLeadBrake(s: Scenario, decisions: ReplayDecision[], collisionFrom?: boolean[]): { rows: Row[]; decisionsUsed: number } {
  if (s.family !== 'lead_brake') throw new Error(`replay supports lead_brake only, not ${s.family}`)
  const dt = s.dt_s
  const runupN = Math.round(s.runup_s / dt), cpN = Math.round(s.checkpoint_s / dt), horizonN = Math.round(s.horizon_s / dt)
  const aMin = -0.8 * G * s.friction_mu, fifoLen = Math.round(IDM.reaction_delay_s / dt) + 1
  const fifo: [number, number][] = []
  let t = 0.0, egoX = 0.0, egoV = s.ego_speed_mps, leadX = s.initial_gap_m + HALF_LENS_M, leadV = s.lead_speed_mps
  let vHold = s.lead_speed_mps, decel: number | null = null
  const idmAccel = (v: number, gap: number, vLead: number) => {
    const sStar = IDM.min_gap_m + v * IDM.time_headway_s + v * (v - vLead) / (2 * Math.sqrt(IDM.max_accel_mps2 * IDM.comfort_decel_mps2))
    const r = v / IDM.desired_speed_mps, q = sStar / pyMax(gap, 0.1)
    return pyMin(pyMax(IDM.max_accel_mps2 * (1 - r * r * r * r - q * q), aMin), IDM.max_accel_mps2)
  }
  const setDecel = (d: number | null) => {
    if (d) d = pyMin(d, 0.8 * G * s.friction_mu)
    else vHold = leadV
    decel = d || null
  }
  const rows: Row[] = []
  let state = 'READY', n = 0, k = 0, haltN = 0, stoppedN = 0, last: Row | null = null
  for (;;) {
    if ((state === 'READY' || state === 'EXECUTING') && last && n >= runupN && (n - runupN) % cpN === 0 && n < horizonN) {
      const d = decisions[k++]
      if (!d) throw new Error(`replay needs decision ${k - 1}; the log has ${decisions.length}`)
      if (d.source === 'none') { state = 'SAFE_HALT'; haltN = n } else state = 'EXECUTING'
      setDecel(d.control_decel_mps2 || null)
    }
    // KinematicWorld.tick
    fifo.push([leadX - egoX - HALF_LENS_M, leadV]); if (fifo.length > fifoLen) fifo.shift()
    const egoA = idmAccel(egoV, fifo[0][0], fifo[0][1])
    const leadA = decel === null ? pyMin(pyMax(0.8 * (vHold - leadV), -1.0), 1.5) : leadV > 0.05 ? -decel : 0.0
    egoV = pyMax(0.0, egoV + egoA * dt)
    leadV = pyMax(0.0, leadV + leadA * dt)
    egoX += egoV * dt
    leadX += leadV * dt
    t = round6(t + dt)
    const gap = leadX - egoX - HALF_LENS_M
    const collision = collisionFrom ? collisionFrom[n] === true : gap <= 0
    last = { t_s: t, ego_x: egoX, ego_v: egoV, ego_a: egoA, lead_x: leadX, lead_v: leadV, lead_a: leadA, gt_gap: gap,
      lidar_gap: gap, lidar_closing: egoV - leadV, collision }
    n++
    rows.push(Object.fromEntries(Object.entries(last).map(([f, v]) => [f, typeof v === 'number' ? round6(v) : v])) as Row)
    stoppedN = egoV < SAFE_HALT_STOP.STOPPED_V && leadV < SAFE_HALT_STOP.STOPPED_V ? stoppedN + 1 : 0
    if (collision) break
    if (state === 'SAFE_HALT') { if (stoppedN > 0 || (n - haltN) * dt >= SAFE_HALT_STOP.HALT_MAX_S) break }
    else if (n >= horizonN || stoppedN * dt >= SAFE_HALT_STOP.STOPPED_HOLD_S) break
    if (collisionFrom && n >= collisionFrom.length) break
  }
  return { rows, decisionsUsed: k }
}

export const GT_FIELDS = ['t_s', 'ego_x', 'ego_v', 'ego_a', 'lead_x', 'lead_v', 'lead_a', 'gt_gap'] as const
export const LIDAR_FIELDS = ['lidar_gap', 'lidar_closing', 'collision'] as const

/** Compare a replay with the published trajectory: ground-truth fields always, LiDAR fields only for kinematic runs
 *  (CARLA ray-casts are not bit-deterministic). Exact equality, tolerance 0. */
export function compareReplay(published: any[], replayed: Row[], kinematic: boolean, decisionsTotal: number, decisionsUsed: number) {
  const fields: readonly string[] = kinematic ? [...GT_FIELDS, ...LIDAR_FIELDS] : GT_FIELDS
  let firstMismatch: { tick: number; field: string; published: unknown; replayed: unknown } | null = null
  const n = Math.min(published.length, replayed.length)
  for (let i = 0; i < n && !firstMismatch; i++)
    for (const f of fields) if (!Object.is(published[i][f], (replayed[i] as any)[f])) { firstMismatch = { tick: i, field: f, published: published[i][f], replayed: (replayed[i] as any)[f] }; break }
  return { ok: !firstMismatch && published.length === replayed.length && decisionsUsed === decisionsTotal,
    ticks: published.length, replayedTicks: replayed.length, fields, firstMismatch }
}

/** Replay a public episode from its reveal. null when nothing is revealed; cut-in episodes are not ported (skipped). */
export function checkReplay(pub: any) {
  if (typeof pub.reveal?.scenario_json !== 'string') return null
  const s = JSON.parse(pub.reveal.scenario_json)
  if (s.family !== 'lead_brake') return { ok: null, skipped: `${s.family} replay is not ported to the browser (Python replay only)` }
  const published = (pub.trajectory_jsonl as string).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const kinematic = pub.manifest.world === 'kinematic'
  try {
    const r = replayLeadBrake(s, pub.decisions, kinematic ? undefined : published.map((row) => row.collision === true))
    return { ...compareReplay(published, r.rows, kinematic, pub.decisions.length, r.decisionsUsed), kinematic }
  } catch (e) {
    return { ok: false, kinematic, error: (e as Error).message }
  }
}
