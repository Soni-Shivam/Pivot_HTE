// Deterministic policy gate (SECURITY I5). The LLM proposes a tool call; this code decides. Strict: unknown keys,
// wrong types and off-enum values are rejected, never coerced.
import { BASELINE, ENUMS, type Catalog, type Recipe } from './catalog.ts'

export type Budgets = { maxPlannerCalls: number; maxGpuSeconds: number; maxWallClockSec: number; maxTrainingRuns: number }
export type ToolName = 'inspect_asset_card' | 'inspect_data_summary' | 'propose_recipe' | 'run_training' | 'read_metrics' | 'finish'
export type ToolCall =
  | { tool: 'inspect_asset_card'; args: Record<string, never> }
  | { tool: 'inspect_data_summary'; args: Record<string, never> }
  | { tool: 'propose_recipe'; args: { recipe: Recipe; reason?: string } }
  | { tool: 'run_training'; args: { proposalId: string } }
  | { tool: 'read_metrics'; args: { runId: string } }
  | { tool: 'finish'; args: { selected: string; rationale: string } }
export type GateResult = { ok: true; call: ToolCall } | { ok: false; reason: string; code: 'INVALID' | 'MAX_RUNS' }
export type GateState = { proposals: Map<string, Recipe>; runs: Map<string, unknown>; runsStarted: number }

const TOOLS: ToolName[] = ['inspect_asset_card', 'inspect_data_summary', 'propose_recipe', 'run_training', 'read_metrics', 'finish']
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

class Reject extends Error {}
function keys(o: Record<string, unknown>, required: string[], optional: string[] = []) {
  for (const k of required) if (!(k in o)) throw new Reject(`missing "${k}"`)
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Reject(`unexpected key "${k}"`)
}
function oneOf<T>(v: unknown, allowed: readonly T[], name: string): T {
  if (!allowed.includes(v as T)) throw new Reject(`${name}=${JSON.stringify(v)} is not one of ${JSON.stringify(allowed)}`)
  return v as T
}
function text(v: unknown, name: string, max: number) {
  if (typeof v !== 'string' || v.length > max) throw new Reject(`${name} must be a string of at most ${max} chars`)
  return v
}

export function validateRecipe(v: unknown, catalog: Catalog): Recipe {
  if (!isObj(v)) throw new Reject('recipe must be an object')
  const method = oneOf(v.method, ENUMS.method, 'method')
  keys(v, ['method', 'optim', 'classWeights', 'maxLen'], method === 'lora' ? ['lora'] : [])
  if (!isObj(v.optim)) throw new Reject('optim must be an object')
  keys(v.optim, ['lr', 'epochs', 'batch', 'warmup'])
  const recipe: Recipe = {
    method,
    optim: {
      lr: oneOf(v.optim.lr, ENUMS.lr, 'optim.lr'),
      epochs: oneOf(v.optim.epochs, ENUMS.epochs, 'optim.epochs'),
      batch: oneOf(v.optim.batch, ENUMS.batch, 'optim.batch'),
      warmup: oneOf(v.optim.warmup, ENUMS.warmup, 'optim.warmup'),
    },
    classWeights: oneOf(v.classWeights, ENUMS.classWeights, 'classWeights'),
    maxLen: oneOf(v.maxLen, ENUMS.maxLen, 'maxLen'),
  }
  if (method === 'lora') {
    if (!isObj(v.lora)) throw new Reject('method "lora" needs a lora object')
    keys(v.lora, ['r', 'alpha', 'dropout', 'targets'])
    const t = v.lora.targets
    if (!Array.isArray(t) || t.length === 0 || new Set(t).size !== t.length) throw new Reject('lora.targets must be a non-empty list without repeats')
    for (const x of t) oneOf(x, catalog.allowedTargets, 'lora.targets[]')
    recipe.lora = {
      r: oneOf(v.lora.r, ENUMS.r, 'lora.r'),
      alpha: oneOf(v.lora.alpha, ENUMS.alpha, 'lora.alpha'),
      dropout: oneOf(v.lora.dropout, ENUMS.dropout, 'lora.dropout'),
      targets: [...(t as string[])].sort(),
    }
  }
  return recipe
}

export class PolicyGate {
  constructor(private catalog: Catalog, private budgets: Budgets) {}

  check(call: unknown, state: GateState): GateResult {
    try {
      if (!isObj(call)) throw new Reject('reply must be one JSON object {"tool": ..., "args": {...}}')
      keys(call, ['tool', 'args'])
      const tool = oneOf(call.tool, TOOLS, 'tool')
      const args = call.args
      if (!isObj(args)) throw new Reject('args must be an object')
      switch (tool) {
        case 'inspect_asset_card':
        case 'inspect_data_summary':
          keys(args, [])
          return { ok: true, call: { tool, args: {} } }
        case 'propose_recipe':
          keys(args, ['recipe'], ['reason'])
          return {
            ok: true,
            call: { tool, args: { recipe: validateRecipe(args.recipe, this.catalog), ...(args.reason !== undefined && { reason: text(args.reason, 'reason', 300) }) } },
          }
        case 'run_training': {
          keys(args, ['proposalId'])
          const id = text(args.proposalId, 'proposalId', 32)
          if (!state.proposals.has(id)) throw new Reject(`unknown proposalId "${id}"`)
          if (state.runsStarted >= this.budgets.maxTrainingRuns) return { ok: false, code: 'MAX_RUNS', reason: `at most ${this.budgets.maxTrainingRuns} training runs` }
          return { ok: true, call: { tool, args: { proposalId: id } } }
        }
        case 'read_metrics': {
          keys(args, ['runId'])
          const id = text(args.runId, 'runId', 32)
          if (id !== BASELINE && !state.runs.has(id)) throw new Reject(`unknown runId "${id}"`)
          return { ok: true, call: { tool, args: { runId: id } } }
        }
        case 'finish': {
          keys(args, ['selected', 'rationale'])
          const sel = text(args.selected, 'selected', 32)
          if (sel !== BASELINE && !state.runs.has(sel)) throw new Reject(`cannot select unknown run "${sel}"`)
          return { ok: true, call: { tool, args: { selected: sel, rationale: text(args.rationale, 'rationale', 500) } } }
        }
      }
    } catch (e) {
      if (e instanceof Reject) return { ok: false, code: 'INVALID', reason: e.message }
      throw e
    }
  }
}
