import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateRegression } from '../src/regression-gate.ts'
import { kinematicPolicyCommitment } from '../src/kinematic-policy.ts'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
function run(dir: string, ttc: number, collision: boolean, action = 'CUT_IN', metricTtc = ttc) {
  mkdirSync(dir)
  const scenario = '{"family":"cut_in","seed":42}\n'
  const decision = JSON.stringify({ i: 0, prev_hash: '0'.repeat(64), cp: 0, source: '0g', action, reason: 'ok' })
  const decisions = `${decision}\n`
  const trajectory = `${JSON.stringify({ t_s: 1, gt_in_path: true, gt_ttc_s: ttc, collision, ccs: 0.9 })}\n`
  const metrics = `${JSON.stringify({ ground_truth: { min_ttc_s: metricTtc, collision } })}\n`
  const files = { 'scenario.json': scenario, 'decisions.jsonl': decisions, 'trajectory.jsonl': trajectory, 'metrics.json': metrics }
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ world: 'kinematic-cut-in',
    paid_binding: { suite: 'cut-in-v1', suiteVersion: 1, jobId: 'a'.repeat(32), policyCommitment: `0x${'b'.repeat(64)}` },
    replay_policy_commitment: kinematicPolicyCommitment(),
    decisions_0g: 1, log_head: hash(decision), files: Object.fromEntries(Object.entries(files).map(([n, data]) => [n, hash(data)])) }))
}

test('regression gate requires the same paid adversary trace and recomputes the outcome', () => {
  const root = mkdtempSync(join(tmpdir(), 'faultline-gate-'))
  try {
    const baseline = join(root, 'baseline'), candidate = join(root, 'candidate')
    run(baseline, 0.5, true)
    run(candidate, 2.0, false)
    assert.equal(evaluateRegression(baseline, candidate, 1.5).verdict, 'fixed')
    rmSync(candidate, { recursive: true })
    run(candidate, 2.0, false, 'BRAKE_HARD')
    assert.throws(() => evaluateRegression(baseline, candidate, 1.5), /adversary decisions changed/)
    rmSync(candidate, { recursive: true })
    run(candidate, 2.0, false, 'CUT_IN', 3.0)
    assert.throws(() => evaluateRegression(baseline, candidate, 1.5), /metrics differ from trajectory/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
