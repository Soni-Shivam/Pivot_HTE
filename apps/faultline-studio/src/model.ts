// Studio information architecture: the scenario catalog, routes and the "which run am I looking at" context.
// Plan: docs/superpowers/plans/2026-11-07-studio-rebuild.md. Pure: no DOM, unit-tested in test/model.test.ts.

/** Paid test 002: the anchored CARLA cut-in (docs/evidence/faultline-paid-job-002-carla.md). */
export const FEATURED = 'paid-de2d56fd2f3cd49fb30c1a7633f9d8c1-1794006602051'

export type Scenario = { id: string, title: string, what: string, live: boolean, run: string | null, clip: string | null, poster: string, families: string[] }

// Featured runs: the real 0G-driven recording of each scenario (/api/runs). Pedestrian and intersection have none yet.
export const SCENARIOS: Scenario[] = [
  { id: 'cut-in', title: 'Cut-in', live: true, run: FEATURED, clip: 'cut-in', poster: '/clips/cut-in.jpg', families: ['cut_in'],
    what: 'An attacker car in the next lane overtakes and cuts sharply into the lane of the car under test, then brakes.' },
  { id: 'swarm', title: 'Coordinated multi-vehicle attack', live: false, run: 'swarm-carla-010', clip: null, poster: '/stills/squeeze.jpg', families: ['swarm', 'swarm_box'],
    what: 'One planning call to 0G assigns roles to four cars. Then a 0G call every second steers all four at once to box the car under test in.' },
  { id: 'lead-brake', title: 'Lead vehicle brakes', live: false, run: 'demo-003', clip: 'lead-brake', poster: '/clips/lead-brake.jpg', families: ['lead_brake'],
    what: 'The car ahead brakes hard at the moment the attacker model picks, to see whether the car under test keeps a safe gap.' },
  { id: 'lidar-dropout', title: 'LiDAR dropout', live: false, run: 'cutin-001', clip: 'lidar-dropout', poster: '/clips/lidar-dropout.jpg', families: [],
    what: 'The cut-in replayed with the same 0G decisions while part of the LiDAR goes dark: random point dropout up to 90% and a blacked-out sector on the side the attacker comes from.' },
  { id: 'pedestrian', title: 'Pedestrian crossing', live: false, run: null, clip: 'pedestrian', poster: '/clips/pedestrian.jpg', families: [],
    what: 'A pedestrian steps out between two parked vehicles into the lane and stops.' },
  { id: 'intersection', title: 'Intersection conflict', live: false, run: null, clip: 'intersection', poster: '/clips/intersection.jpg', families: [],
    what: 'A car pulls out of a side street late and fast, turning across the path of the car under test.' },
]

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id)
export const isJob = (id: string) => /^[0-9a-f]{16}$/.test(id)

export function scenarioForRun(name: string, family?: string | null): Scenario | undefined {
  // the LiDAR-dropout page borrows cut-in run cutin-001 (its decisions are replayed), so that run still belongs to the cut-in
  return SCENARIOS.find((s) => s.run === name && s.id !== 'lidar-dropout') ?? (isJob(name) ? SCENARIOS[0] : undefined)
    ?? (family ? SCENARIOS.find((s) => s.families.includes(family)) : undefined)
}

/** URL path for a run name; names can contain '/' (CARLA demo runs), so each segment is encoded on its own. */
export const runPath = (name: string) => name.split('/').map(encodeURIComponent).join('/')

export type Page = 'home' | 'scenario' | 'lab' | 'mission' | 'results' | 'research' | 'verify' | 'stack'
export function parseRoute(pathname: string): { page: Page, id: string } {
  const [, a = '', ...rest] = pathname.split('/'), id = rest.map(decodeURIComponent).join('/')
  if (a === 'scenario' && scenarioById(id)) return { page: 'scenario', id }
  if (a === 'mission' || a === 'results' || a === 'verify') return { page: a, id: id || FEATURED }
  if (a === 'lab' || a === 'research' || a === 'stack') return { page: a, id: '' }
  return { page: 'home', id: '' } // '/', '/library' (v6) and anything unknown
}

export const contextRun = (stored: string | null | undefined) => (stored ? stored : FEATURED)
export const navHrefs = (run: string) => ({ mission: `/mission/${runPath(run)}`, results: `/results/${runPath(run)}`, verify: `/verify/${runPath(run)}` })
export const runLabel = (name: string) => (name === FEATURED ? 'Paid test 002' : isJob(name) ? `Your run ${name.slice(0, 8)}` : name)
