// Proves (T02B): the live customization agent on 0G Private Computer drives REAL LoRA training of the seller's
// model on the buyer's data through the ML plane: baseline → agent-chosen runs → finish → holdout once.
// TEST RUN on a dev GPU with synthetic data, NOT inside a TEE: nothing here is a confidential job (SECURITY I12).
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { runCustomization, catalogV1 } from '@sealedai/planner'
import { routerLlm } from '@sealedai/integrations'
import { MlPlane } from '@sealedai/worker'

const bundle = process.argv[2] ?? 'worker/ml/models/seller-triage-v1'
const dataset = process.argv[3] ?? 'fixtures/buyer-isp-tickets.jsonl'
const card = JSON.parse(readFileSync(`${bundle}/card.json`, 'utf8'))
const rows = readFileSync(dataset, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

const ml = new MlPlane()
try {
  console.log('model', await ml.loadModel(bundle))
  const { summary, holdoutRows } = await ml.loadData(rows, `0x${randomBytes(32).toString('hex')}`)
  console.log('summary (all the agent may see of the data):', JSON.stringify(summary), `holdout=${holdoutRows} rows (locked)`)
  const r = await runCustomization({
    llm: routerLlm({ baseUrl: process.env.ZG_ROUTER_URL!, apiKey: process.env.ZG_API_KEY! }),
    trainer: ml,
    catalog: catalogV1(card),
    budgets: { maxPlannerCalls: 10, maxGpuSeconds: 300, maxWallClockSec: 900, maxTrainingRuns: 2 },
    goal: 'Route our ISP support tickets. Outages are rare but must not be missed.',
    card,
    summary,
    onEvent: (e) => console.log(`#${e.i} ${e.kind}${e.requestId ? ` [${e.requestId.split(',')[0]}]` : ''} ${JSON.stringify(e.data).slice(0, 240)}`),
  })
  console.log(`\nstop=${r.stopReason} selected=${r.selected} plannerCalls=${r.plannerCalls} gpuSeconds=${r.gpuSeconds.toFixed(1)}`)
  console.log(`baseline val F1=${r.baseline.valMacroF1}  ${r.runs.map((x) => `${x.id} val F1=${x.metrics.valMacroF1}`).join('  ')}  holdout F1=${r.holdout.valMacroF1}`)
  for (const t of ['no internet in Bandra since last night', 'my april bill has a fee I did not agree to', 'how do I port my number']) {
    console.log(`infer(${JSON.stringify(t)}) ->`, (await ml.predict(r.selected, t)).label)
  }
  console.log(`timeline head ${r.timelineHead}\n(TEST RUN: synthetic data on a dev GPU, not a TEE)`)
} finally {
  ml.close()
}
