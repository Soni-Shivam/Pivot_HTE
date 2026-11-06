// Proves (T02A): the real customization agent on 0G Private Computer drives the policy-gated loop. The trainer
// here returns RECORDED metrics (a test stand-in for the ML plane, not a product mode): only the agent is live.
import 'dotenv/config'
import { runCustomization, catalogV1, type Recipe, type Metrics } from '@sealedai/planner'
import { routerLlm } from '@sealedai/integrations'

const catalog = catalogV1({ allowedTargets: ['q_lin', 'v_lin'] })
const m = (f1: number, trainLoss: number): Metrics => ({ valLoss: 1.1 - f1, valAccuracy: f1 + 0.03, valMacroF1: f1, trainLoss })
// Recorded behaviour of a small classifier: high lr / many epochs overfit; balanced weights help the rare class.
const recorded = (r: Recipe): Metrics => {
  let f1 = 0.7
  if (r.optim.lr === 2e-4) f1 -= 0.12
  if (r.optim.epochs === 3) f1 -= 0.05
  if (r.classWeights === 'balanced') f1 += 0.06
  if (r.method === 'head_only') f1 -= 0.04
  return m(Number(f1.toFixed(3)), r.optim.lr === 2e-4 ? 0.04 : 0.35)
}

const r = await runCustomization({
  llm: routerLlm({ baseUrl: process.env.ZG_ROUTER_URL!, apiKey: process.env.ZG_API_KEY! }),
  trainer: { baseline: async () => m(0.58, 0.9), train: async (rec) => ({ metrics: recorded(rec), gpuSeconds: 120 }), holdout: async () => m(0.71, 0.3) },
  catalog,
  budgets: { maxPlannerCalls: 10, maxGpuSeconds: 600, maxWallClockSec: 600, maxTrainingRuns: 2 },
  goal: 'Route support tickets; outages are rare but must not be missed.',
  card: { name: 'triage-distilbert', task: 'text-classification', labels: ['billing', 'outage', 'other'], allowedTargets: ['q_lin', 'v_lin'] },
  summary: { rows: { train: 1200, val: 400 }, labelHistogram: { billing: 640, outage: 90, other: 470 }, tokenLenP50: 38, tokenLenP95: 92 },
  onEvent: (e) => console.log(`#${e.i} ${e.kind}${e.requestId ? ` [${e.requestId}]` : ''} ${JSON.stringify(e.data).slice(0, 220)}`),
})
console.log(`\nstop=${r.stopReason} selected=${r.selected} plannerCalls=${r.plannerCalls} holdoutF1=${r.holdout.valMacroF1} head=${r.timelineHead}`)
console.log('(metrics recorded, test run: the agent and its request IDs are live)')
