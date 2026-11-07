// Attack catalogue (Discover, Lab, Explore runs share it), featured runs and the four swarm roles.
import { FEATURED, LEAD_BRAKE, SWARM, href, type AttackId } from '../routes'
import { esc } from './dom'

export { FEATURED, LEAD_BRAKE, SWARM }

// live = runs from the Lab now; recorded = a real 0G run exists but it is not a Lab option; dev = preview of the situation only
export type AttackStatus = 'live' | 'recorded' | 'dev'
export type Attack = { id: string, title: string, line: string, status: AttackStatus, media: string, run: string | null, actions: [string, string, string?][] }
export const CATALOGUE: Attack[] = [
  { id: 'cut-in', title: 'Cut-in', status: 'live', media: 'img:/stills/paid.jpg', run: FEATURED, line: 'One 0G-controlled car overtakes and cuts in ahead of your car, timing the move to your gap and speed.',
    actions: [['Run it live', href.lab('cut-in'), 'k'], ['Watch a recorded run', href.mission(FEATURED)]] },
  { id: 'swarm', title: 'Coordinated four-car attack', status: 'live', media: 'img:/stills/box.jpg', run: SWARM, line: 'The 0G strategist writes a plan and gives each of four cars a role, then steers all four every second to box your car in.',
    actions: [['Run it live', href.lab('swarm'), 'k'], ['Watch a recorded run', href.mission(SWARM)]] },
  { id: 'lead-brake', title: 'Lead vehicle brakes', status: 'recorded', media: '', run: LEAD_BRAKE, line: 'The car ahead brakes hard at a moment the 0G attacker picks. Recorded in CARLA and in our research runs; not yet a Lab option.',
    actions: [['Watch a recorded run', href.mission(LEAD_BRAKE), 'k'], ['See the research', href.research('counterfactual')]] },
  { id: 'pedestrian', title: 'Pedestrian steps out', status: 'dev', media: 'clip:pedestrian', run: null, line: 'A pedestrian walks out from between parked vehicles into your lane.', actions: [] },
  { id: 'lidar-dropout', title: 'LiDAR dropout', status: 'dev', media: 'clip:lidar-dropout', run: null, line: 'The attacker blinds the part of your LiDAR that sees the obstacle for about a second.', actions: [] },
  { id: 'intersection', title: 'Intersection conflict', status: 'dev', media: 'clip:intersection', run: null, line: 'A car pulls out of a side street late and fast, across your path.', actions: [] },
]
const STATUS: Record<AttackStatus, [string, string]> = { live: ['live', 'Runs live'], recorded: ['', 'Recorded run'], dev: ['dev', 'In development'] }
export const attackChip = (a: Attack) => `<span class="chip ${STATUS[a.status][0]}">${STATUS[a.status][1]}</span>`
export const isClip = (a: Attack) => a.media.startsWith('clip:')
// self-check: scripted clips never sit on a live or recorded card
for (const a of CATALOGUE) console.assert(!isClip(a) || a.status === 'dev', `catalogue: preview clip on ${a.status} card ${a.id}`)
/**
 * Card media: looping clip (start it with a data-loop observer), still, or a plain panel. Clips are scripted previews (public/clips/README.md),
 * so only In-development entries may use them; live and recorded cards show a frame of the real run or nothing.
 */
export const attackMedia = (a: Attack) => !a.media
  ? `<div role="img" aria-label="${esc(a.title)}: recorded run, no camera still" style="box-sizing:border-box;width:100%;aspect-ratio:16/9;border-radius:16px;border:1.5px solid var(--line);background:var(--ink);color:var(--paper);display:grid;place-items:center;padding:16px;text-align:center;font:500 14px/1.4 'JetBrains Mono',monospace">Recorded run ${esc(a.run ?? '')}<br>telemetry and 0G decisions</div>`
  : isClip(a)
  ? `<video muted loop playsinline preload="none" poster="/clips/${a.media.slice(5)}.jpg" data-loop="/clips/${a.media.slice(5)}.mp4" aria-label="${esc(a.title)}${a.status === 'dev' ? ' (preview)' : ''}"></video>`
  : `<img src="${a.media.slice(4)}" alt="${esc(a.title)}" loading="lazy" width="960" height="540">`
export const previewTag = (a: Attack) => (isClip(a) && a.status === 'dev' ? '<span class="chip dev">Preview</span>' : '')

/** Lab suites (POST /api/demo-run suite). Swarm: free only, PDM-Lite only; paid tests are cut-in only. */
export const SUITES: { id: string, key: AttackId, name: string, line: string }[] = [
  { id: 'cut-in-v1-carla', key: 'cut-in', name: 'Cut-in', line: 'One 0G-controlled car cuts in ahead of yours in CARLA. About 90 seconds.' },
  { id: 'swarm-v1-carla', key: 'swarm', name: 'Coordinated four-car attack', line: '0G writes a plan, then steers four cars every second to box your car in. About 2 minutes.' },
]
export const SWARM_SUITE = 'swarm-v1-carla'

// Swarm roles: the run's own plan (stream 'plan' event, /api/showcase) replaces these; car colours match the CARLA recording.
export const ROLES: Record<string, string> = { A: 'Lead vehicle, progressive braking', B: 'Front cut-in, block right lane', C: 'Rear cut-in, compress gap', D: 'Rear guard, maintain safe distance' }
export const ROLE_CAR: Record<string, [string, string]> = { A: ['#e5484d', 'red car'], B: ['#f3c623', 'yellow taxi'], C: ['#3b82f6', 'blue car'], D: ['#d63384', 'magenta car'] }
export const rolesHtml = (roles: Record<string, string> = ROLES) => Object.entries(roles).map(([k, v]) => `<li><i style="background:${ROLE_CAR[k]?.[0] ?? '#999'}"></i><b>${esc(k)}</b> ${esc(ROLE_CAR[k]?.[1] ?? '')}: ${esc(v)}</li>`).join('')
