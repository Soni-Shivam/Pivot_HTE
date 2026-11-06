// The customization loop (ARCHITECTURE §8): baseline → ≤ N agent-chosen trainings with validation feedback → finish
// → holdout exactly once. The LLM only proposes; PolicyGate and this loop enforce every budget (I5, I6).
import { Timeline, type TimelineEvent } from '@sealedai/protocol'
import { BASELINE, type Catalog, type Recipe } from './catalog.ts'
import { TierUnavailableError, type Llm, type Msg } from './llm.ts'
import { PolicyGate, type Budgets, type GateState } from './policy.ts'
import { systemPrompt, untrusted } from './prompt.ts'

export type Metrics = {
  trainLoss?: number
  valLoss: number
  valAccuracy: number
  valMacroF1: number
  perClass?: Record<string, { f1: number; n: number }>
}
export type DataSummary = { rows: { train: number; val: number }; labelHistogram: Record<string, number>; tokenLenP50: number; tokenLenP95: number }
export type TrainResult = { metrics: Metrics; gpuSeconds: number; stoppedByBudget?: boolean }
export interface Trainer {
  baseline(): Promise<Metrics>
  train(recipe: Recipe, runId: string, gpuSecondsLeft: number): Promise<TrainResult>
  holdout(runId: string): Promise<Metrics>
}
export enum StopReason { FINISHED = 1, BUDGET_CALLS = 2, BUDGET_TIME = 3, MAX_RUNS = 4, PLANNER_UNAVAILABLE = 5, PLANNER_INVALID = 6 }
export type Run = { id: string; recipe: Recipe; metrics: Metrics; gpuSeconds: number; stoppedByBudget: boolean; requestIds: string[]; reason?: string }
export type RunResult = {
  baseline: Metrics
  runs: Run[]
  selected: string
  rationale: string
  holdout: Metrics
  stopReason: StopReason
  plannerCalls: number
  gpuSeconds: number
  timeline: TimelineEvent[]
  timelineHead: string
}

/** Holdout lock (I6): unreachable until the loop freezes a selection, then usable exactly once. */
export class HoldoutGuard {
  private unlocked = false
  private used = false
  constructor(private trainer: Trainer) {}
  unlock() { this.unlocked = true }
  async holdout(runId: string) {
    if (!this.unlocked) throw new Error('holdout is locked until the agent finishes')
    if (this.used) throw new Error('holdout may be evaluated only once')
    this.used = true
    return this.trainer.holdout(runId)
  }
}

const round = (m: Metrics): Metrics => {
  const r = (x: number) => Math.round(x * 1000) / 1000
  const out: Metrics = { valLoss: r(m.valLoss), valAccuracy: r(m.valAccuracy), valMacroF1: r(m.valMacroF1) }
  if (m.trainLoss !== undefined) out.trainLoss = r(m.trainLoss)
  if (m.perClass) out.perClass = Object.fromEntries(Object.entries(m.perClass).filter(([, v]) => v.n >= 5).map(([k, v]) => [k, { f1: r(v.f1), n: v.n }]))
  return out
}

function parseReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(t) } catch { return undefined }
}

export async function runCustomization(o: {
  llm: Llm
  trainer: Trainer
  catalog: Catalog
  budgets: Budgets
  goal: string
  card: unknown
  summary: DataSummary
  clock?: () => number
  onEvent?: (e: TimelineEvent) => void
}): Promise<RunResult> {
  const clock = o.clock ?? Date.now
  const t0 = clock()
  const tl = new Timeline(clock)
  const log = (...a: Parameters<Timeline['append']>) => { const e = tl.append(...a); o.onEvent?.(e) }
  const gate = new PolicyGate(o.catalog, o.budgets)
  const guard = new HoldoutGuard(o.trainer)
  const state: GateState = { proposals: new Map(), runs: new Map(), runsStarted: 0 }
  const proposalMeta = new Map<string, { requestId: string; reason?: string }>()
  const runs: Run[] = []
  let plannerCalls = 0
  let gpuUsed = 0
  let invalidStreak = 0
  let stop: StopReason | undefined
  let selected = BASELINE
  let rationale = ''

  const baseline = round(await o.trainer.baseline())
  log('metrics', { runId: BASELINE, metrics: baseline })

  const messages: Msg[] = [
    { role: 'system', content: systemPrompt(o.catalog, o.budgets) },
    { role: 'user', content: `Buyer goal: ${untrusted('buyer-goal', o.goal)}\nBaseline (seller model as-is) on validation: ${JSON.stringify(baseline)}\nStart.` },
  ]

  while (stop === undefined) {
    if (plannerCalls >= o.budgets.maxPlannerCalls) { stop = StopReason.BUDGET_CALLS; break }
    if ((clock() - t0) / 1000 >= o.budgets.maxWallClockSec) { stop = StopReason.BUDGET_TIME; break }
    let reply: Awaited<ReturnType<Llm['next']>>
    try {
      reply = await o.llm.next(messages)
    } catch (e) {
      if (e instanceof TierUnavailableError) { log('error', { planner: 'unavailable', message: e.message }); stop = StopReason.PLANNER_UNAVAILABLE; break }
      throw e
    }
    plannerCalls++
    messages.push({ role: 'assistant', content: reply.text })
    const verdict = gate.check(parseReply(reply.text), state)
    if (!verdict.ok) {
      log('policy_reject', { reason: verdict.reason, reply: reply.text.slice(0, 500) }, reply.requestId)
      if (verdict.code === 'MAX_RUNS') { stop = StopReason.MAX_RUNS; break }
      if (++invalidStreak >= 3) { stop = StopReason.PLANNER_INVALID; break }
      messages.push({ role: 'user', content: `REJECTED by policy: ${verdict.reason}. Reply with one valid JSON tool call.` })
      continue
    }
    invalidStreak = 0
    const { call } = verdict
    let result: unknown
    switch (call.tool) {
      case 'inspect_asset_card':
        result = untrusted('seller-card', o.card)
        break
      case 'inspect_data_summary':
        result = o.summary
        break
      case 'propose_recipe': {
        const id = `p${state.proposals.size + 1}`
        state.proposals.set(id, call.args.recipe)
        proposalMeta.set(id, { requestId: reply.requestId, reason: call.args.reason })
        const last = runs.at(-1)
        log(last ? 'decision' : 'plan', { proposalId: id, recipe: call.args.recipe, reason: call.args.reason, ...(last && { after: last.id, afterMetrics: last.metrics }) }, reply.requestId)
        result = { proposalId: id }
        break
      }
      case 'run_training': {
        if (gpuUsed >= o.budgets.maxGpuSeconds) { stop = StopReason.BUDGET_TIME; break }
        const recipe = state.proposals.get(call.args.proposalId)!
        const id = `run${state.runsStarted + 1}`
        state.runsStarted++
        log('train_start', { runId: id, proposalId: call.args.proposalId, recipe }, reply.requestId)
        const r = await o.trainer.train(recipe, id, o.budgets.maxGpuSeconds - gpuUsed)
        gpuUsed += r.gpuSeconds
        const metrics = round(r.metrics)
        const meta = proposalMeta.get(call.args.proposalId)!
        runs.push({ id, recipe, metrics, gpuSeconds: r.gpuSeconds, stoppedByBudget: !!r.stoppedByBudget, requestIds: [meta.requestId, reply.requestId], reason: meta.reason })
        state.runs.set(id, metrics)
        log('train_end', { runId: id, gpuSeconds: r.gpuSeconds, stoppedByBudget: !!r.stoppedByBudget, metrics })
        result = { runId: id, gpuSecondsUsed: r.gpuSeconds, stoppedByBudget: !!r.stoppedByBudget, metrics }
        break
      }
      case 'read_metrics':
        result = call.args.runId === BASELINE ? baseline : state.runs.get(call.args.runId)
        break
      case 'finish':
        selected = call.args.selected
        rationale = call.args.rationale
        log('finish', { selected, rationale }, reply.requestId)
        stop = StopReason.FINISHED
        break
    }
    if (stop === undefined) messages.push({ role: 'user', content: `RESULT ${call.tool}: ${JSON.stringify(result)}` })
  }

  if (stop !== StopReason.FINISHED) {
    // Forced finish: the deterministic choice is the best validation macro-F1 (baseline wins ties).
    const best = runs.reduce<{ id: string; f1: number }>((b, r) => (r.metrics.valMacroF1 > b.f1 ? { id: r.id, f1: r.metrics.valMacroF1 } : b), { id: BASELINE, f1: baseline.valMacroF1 })
    selected = best.id
    rationale = `forced finish (${StopReason[stop!]}): best validation macro-F1`
    log('finish', { selected, rationale, stopReason: StopReason[stop!] })
  }
  guard.unlock()
  const holdout = round(await guard.holdout(selected))
  log('holdout', { selected, metrics: holdout })
  return { baseline, runs, selected, rationale, holdout, stopReason: stop!, plannerCalls, gpuSeconds: gpuUsed, timeline: tl.events, timelineHead: tl.head }
}
