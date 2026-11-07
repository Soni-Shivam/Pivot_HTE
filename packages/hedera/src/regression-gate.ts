import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chainOk } from '../../episode/src/check.ts'
import { kinematicPolicyCommitment } from './kinematic-policy.ts'

type Episode = { manifest: Record<string, any>; metrics: Record<string, any>; decisions: any[]; rows: any[]; scenario: Buffer }
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
function episode(dir: string): Episode {
  const bytes = (name: string) => readFileSync(join(dir, name))
  const manifest = JSON.parse(bytes('manifest.json').toString('utf8'))
  const decisionsRaw = bytes('decisions.jsonl')
  const scenario = bytes('scenario.json')
  for (const name of ['scenario.json', 'decisions.jsonl', 'trajectory.jsonl', 'metrics.json'])
    if (manifest.files?.[name] !== sha(bytes(name))) throw new Error(`${dir}: ${name} differs from manifest`)
  if (!chainOk(decisionsRaw.toString('utf8'), manifest.log_head)) throw new Error(`${dir}: decision chain invalid`)
  return { manifest, metrics: JSON.parse(bytes('metrics.json').toString('utf8')),
    decisions: decisionsRaw.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)),
    rows: bytes('trajectory.jsonl').toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)), scenario }
}

const outcome = (ep: Episode, minimumTtc: number) => {
  if (!ep.rows.length || !ep.rows.some(r => r.gt_in_path === true)) throw new Error('ground-truth cut-in rows unavailable')
  const ttcs = ep.rows.filter(r => r.gt_in_path === true && typeof r.gt_ttc_s === 'number').map(r => r.gt_ttc_s as number)
  const ttc = ttcs.length ? Math.min(...ttcs) : null
  const collision = ep.rows.some(r => r.collision === true)
  const reportedTtc = ep.metrics.ground_truth?.min_ttc_s
  if (collision !== ep.metrics.ground_truth?.collision ||
      (ttc === null ? reportedTtc !== null :
        typeof reportedTtc !== 'number' || !Number.isFinite(reportedTtc) || Math.abs(ttc - reportedTtc) > 1e-6))
    throw new Error('ground-truth metrics differ from trajectory')
  let peakTick = 0
  for (let i = 1; i < ep.rows.length; i++)
    if ((ep.rows[i].ccs ?? 0) > (ep.rows[peakTick].ccs ?? 0)) peakTick = i
  return { collision, minTtcSeconds: ttc as number | null,
    passes: !collision && (ttc === null || ttc >= minimumTtc),
    peakTick }
}

export function evaluateRegression(baselineDir: string, candidateDir: string, minimumTtc: number) {
  if (!Number.isFinite(minimumTtc) || minimumTtc <= 0 || minimumTtc > 60)
    throw new Error('minimum TTC must be between 0 and 60 seconds')
  const baseline = episode(baselineDir), candidate = episode(candidateDir)
  const binding = baseline.manifest.paid_binding
  if (binding?.suite !== 'cut-in-v1' || binding?.suiteVersion !== 1 ||
      baseline.manifest.world !== 'kinematic-cut-in' || candidate.manifest.world !== 'kinematic-cut-in')
    throw new Error('requires a paid kinematic cut-in baseline and a kinematic replay')
  if (!/^0x[0-9a-f]{64}$/.test(binding.policyCommitment ?? '') ||
      baseline.decisions.length === 0 || baseline.decisions.some(d => d.source !== '0g') ||
      baseline.manifest.decisions_0g !== baseline.decisions.length)
    throw new Error('baseline has no complete 0G adversary trace')
  if (sha(baseline.scenario) !== sha(candidate.scenario)) throw new Error('scenario changed')
  const decisionView = (e: Episode) => e.decisions.map(d => [d.cp, d.action, d.reason, d.source])
  if (JSON.stringify(decisionView(baseline)) !== JSON.stringify(decisionView(candidate)))
    throw new Error('adversary decisions changed')
  const policyCommitment = kinematicPolicyCommitment()
  if (candidate.manifest.replay_policy_commitment !== policyCommitment)
    throw new Error('candidate replay policy commitment differs from the current source')
  if (policyCommitment === binding.policyCommitment) throw new Error('candidate policy source has not changed')
  const before = outcome(baseline, minimumTtc), after = outcome(candidate, minimumTtc)
  return { schema: 'faultline.regression-gate/v1', jobId: binding.jobId,
    paidEvidenceRoot: baseline.manifest.public_root ?? null, baselinePolicyCommitment: binding.policyCommitment,
    candidatePolicyCommitment: policyCommitment, safetyObjective: { collisionFree: true, minimumTtcSeconds: minimumTtc },
    baseline: before, candidate: after,
    verdict: before.passes ? 'baseline_was_safe' : after.passes ? 'fixed' : 'still_fails' }
}

if (process.argv[1]?.endsWith('regression-gate.ts')) {
  const [baselineDir, candidateDir, threshold] = process.argv.slice(2)
  if (!baselineDir || !candidateDir || !threshold)
    throw new Error('usage: npm run hedera:gate -- <paid-run-dir> <replay-dir> <minimum-ttc-seconds>')
  const result = evaluateRegression(baselineDir, candidateDir, Number(threshold))
  console.log(JSON.stringify(result, null, 2))
  if (result.verdict !== 'fixed') process.exitCode = 1
}
