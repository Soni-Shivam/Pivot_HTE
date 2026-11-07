import { createHash } from 'node:crypto'

// The only runs a payment can buy. `simulator` is the world name the Faultline CLI writes into manifest.world
// (faultline/cutin.py KinematicCutIn.name, faultline/carla_cutin.py CarlaCutIn.name); `args` are the exact CLI args.
export const SUITES = {
  'cut-in-v1-kinematic': { simulator: 'kinematic-cut-in',
    args: ['--world', 'kinematic', '--family', 'cut_in', '--decider', '0g', '--anchor'] },
  'cut-in-v1-carla': { simulator: 'carla-0.10.0-cut-in',
    args: ['--world', 'carla', '--family', 'cut_in', '--decider', '0g', '--anchor'] },
} as const
export type SuiteId = keyof typeof SUITES

export function suiteOf(id: unknown) {
  if (typeof id !== 'string' || !Object.hasOwn(SUITES, id)) throw new Error('unknown_suite')
  return { suite: id as SuiteId, simulator: SUITES[id as SuiteId].simulator }
}

// Bound into the payer's signature and the permit HMAC, so suite and simulator cannot change after payment.
export const requestHash = (suite: SuiteId, policyCommitment: string, idempotencyKey: string) =>
  createHash('sha256').update(JSON.stringify({ suite, simulator: SUITES[suite].simulator, maxRuns: 1,
    policyCommitment: policyCommitment.toLowerCase(), idempotencyKey })).digest('hex')

type Bound = { suite: string, simulator?: string, policyCommitment: string, status: string }

// Server side: one start, only for the exact suite, simulator and policy the payment bought.
export function startAllowed(job: Bound, body: { suite?: unknown, simulator?: unknown, policyCommitment?: unknown }) {
  return job.status === 'accepted' && Object.hasOwn(SUITES, job.suite) && body.suite === job.suite &&
    body.simulator === job.simulator && job.simulator === SUITES[job.suite as SuiteId].simulator &&
    typeof body.policyCommitment === 'string' && body.policyCommitment.toLowerCase() === job.policyCommitment
}

// Runner side: refuse a permit bought for anything but the suite this runner is about to execute.
export function runnerArgs(wanted: string, job: { suite?: unknown, simulator?: unknown }) {
  const { suite, simulator } = suiteOf(wanted)
  if (job.suite !== suite || job.simulator !== simulator) {
    throw new Error(`Permit is for suite ${String(job.suite)} (${String(job.simulator)}), not ${suite} (${simulator})`)
  }
  return [...SUITES[suite].args]
}

// Free demo runs only: the coordinated four-car attack (faultline.carla_swarm). Not in SUITES, so no payment can buy it.
// Its ego is fixed to PDM-Lite on LiDAR (CutInCarlaWorld), so other policies are refused rather than silently swapped.
export const DEMO_SWARM = 'swarm-v1-carla'
export function demoSuite(suite: unknown, mode: unknown, policy: unknown): { lane: 'carla' | 'kin', swarm: boolean } | { error: string } {
  if (suite === DEMO_SWARM) {
    if (mode !== 'free') return { error: 'the coordinated four-car attack runs as a free demo only; paid tests cover the cut-in suites' }
    if (policy !== 'pdm-lite') return { error: 'the coordinated four-car attack runs against PDM-Lite only' }
    return { lane: 'carla', swarm: true }
  }
  if (typeof suite !== 'string' || !Object.hasOwn(SUITES, suite)) return { error: `suite must be one of: ${[...Object.keys(SUITES), DEMO_SWARM].join(', ')}` }
  return { lane: suite === 'cut-in-v1-carla' ? 'carla' : 'kin', swarm: false }
}
