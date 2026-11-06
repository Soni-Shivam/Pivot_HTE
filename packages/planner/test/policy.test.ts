import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PolicyGate, catalogV1, type GateState } from '../src/index.ts'

const catalog = catalogV1({ allowedTargets: ['q_lin', 'v_lin'] })
const gate = new PolicyGate(catalog, { maxPlannerCalls: 10, maxGpuSeconds: 600, maxWallClockSec: 900, maxTrainingRuns: 2 })
const fresh = (): GateState => ({ proposals: new Map(), runs: new Map(), runsStarted: 0 })
const lora = { method: 'lora', lora: { r: 8, alpha: 16, dropout: 0.05, targets: ['q_lin'] }, optim: { lr: 1e-4, epochs: 2, batch: 16, warmup: 0 }, classWeights: 'none', maxLen: 128 }
const propose = (recipe: unknown, extra = {}) => gate.check({ tool: 'propose_recipe', args: { recipe, ...extra } }, fresh())
const rejected = (r: ReturnType<typeof gate.check>, re: RegExp) => { assert.equal(r.ok, false); assert.match((r as { reason: string }).reason, re) }

test('acceptsValidLora', () => assert.equal(propose(lora, { reason: 'small rank first' }).ok, true))
test('acceptsHeadOnly', () => {
  const { lora: _, ...rest } = lora
  assert.equal(propose({ ...rest, method: 'head_only' }).ok, true)
})
test('rejectsUnknownTool', () => rejected(gate.check({ tool: 'run_shell', args: { cmd: 'ls' } }, fresh()), /tool/))
test('rejectsOffEnumLr', () => rejected(propose({ ...lora, optim: { ...lora.optim, lr: 3e-4 } }), /optim\.lr/))
test('rejectsStringNumber', () => rejected(propose({ ...lora, lora: { ...lora.lora, r: '8' } }), /lora\.r/))
test('rejectsExtraKeys', () => {
  rejected(propose({ ...lora, epochs_override: 9 }), /unexpected key/)
  rejected(gate.check({ tool: 'inspect_asset_card', args: {}, note: 'x' }, fresh()), /unexpected key/)
})
test('rejectsTargetNotInCard', () => rejected(propose({ ...lora, lora: { ...lora.lora, targets: ['lm_head'] } }), /targets/))
test('rejectsLoraBlockOnHeadOnly', () => rejected(propose({ ...lora, method: 'head_only' }), /unexpected key "lora"/))
test('rejectsUnknownProposalAndRun', () => {
  rejected(gate.check({ tool: 'run_training', args: { proposalId: 'p9' } }, fresh()), /unknown proposalId/)
  rejected(gate.check({ tool: 'finish', args: { selected: 'run7', rationale: 'x' } }, fresh()), /unknown run/)
})
test('rejectsThirdRun', () => {
  const s = fresh()
  s.proposals.set('p1', lora as never)
  s.runsStarted = 2
  const r = gate.check({ tool: 'run_training', args: { proposalId: 'p1' } }, s)
  assert.equal(r.ok, false)
  assert.equal((r as { code: string }).code, 'MAX_RUNS')
})
test('rejectsNonObjectReply', () => rejected(gate.check('run everything', fresh()), /JSON object/))
