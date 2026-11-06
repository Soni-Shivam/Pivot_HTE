// Static client (T10). Everything runs in the browser against public 0G and Arkiv endpoints the user can swap.
import { browseListings, type VerifiedListing } from '../../../packages/client/src/catalog.ts'
import { WorkerClient, verifyWorker, localSummary } from '../../../packages/client/src/worker-client.ts'
import { routerLlm } from '../../../packages/integrations/src/router.ts'
import { systemPrompt, catalogV1, validateRecipe } from '../../../packages/planner/src/index.ts'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T
const FIELDS = ['rpcUrl', 'indexerUrl', 'arkivKey', 'routerKey', 'routerUrl'] as const
const DEFAULTS: Record<string, string> = { rpcUrl: 'https://evmrpc-testnet.0g.ai', indexerUrl: 'https://indexer-storage-testnet-turbo.0g.ai', routerUrl: 'https://router-api.0g.ai/v1', arkivKey: '', routerKey: '' }
let saved: Record<string, string> = {}
try { saved = JSON.parse(localStorage.getItem('sealedai.settings') ?? '{}') } catch { /* storage blocked: defaults */ }
for (const f of FIELDS) $(f).value = saved[f] ?? DEFAULTS[f]
const cfg = () => Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()])) as Record<(typeof FIELDS)[number], string>
$('save').onclick = () => { try { localStorage.setItem('sealedai.settings', JSON.stringify(cfg())) } catch { /* ignore */ } ; ($('settings') as HTMLDetailsElement).open = false }

// Untrusted strings (listings, model cards, agent replies) are only ever set as textContent, never HTML.
function el(tag: string, text?: string, cls?: string, ...kids: HTMLElement[]) {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  if (cls) e.className = cls
  e.append(...kids)
  return e
}
async function busy(btn: string, fn: () => Promise<void>, out: HTMLElement) {
  const b = $<HTMLButtonElement>(btn)
  b.disabled = true
  try { await fn() } catch (e) { out.replaceChildren(el('p', `✗ ${(e as Error).message}`, 'bad')) } finally { b.disabled = false }
}

let chosen: VerifiedListing | undefined
$('load').onclick = () => busy('load', async () => {
  const c = cfg()
  if (!c.arkivKey) throw new Error('add your Arkiv access key in settings')
  const out = $<HTMLDivElement>('listings')
  out.replaceChildren(el('p', 'Querying Arkiv, then checking each listing against its signed offer on 0G Storage…', 'muted'))
  const { shown, hidden } = await browseListings(c.arkivKey, { rpcUrl: c.rpcUrl, indexerUrl: c.indexerUrl }, { category: $('category').value })
  out.replaceChildren(
    ...shown.map((l) => {
      const card = l.doc.card as { name?: string; architecture?: string; parameters?: number; publicDescription?: string; labels?: string[] }
      const pick = el('button', 'Use this model')
      pick.onclick = () => { chosen = l; $('chosen').textContent = `Model: ${l.title} · ${card.architecture} · labels ${card.labels?.join(', ')}` }
      return el('div', undefined, 'card',
        el('b', l.title), el('p', card.publicDescription ?? ''),
        el('p', `${card.architecture} · ${card.parameters?.toLocaleString()} params · price ${Number(l.price) / 1e6} test USDC · seller ${l.seller}`, 'muted'),
        el('p', `✓ written by the seller · signed offer verified from 0G root ${l.offerRoot.slice(0, 18)}…`, 'ok'), pick)
    }),
    ...(hidden.length ? [el('p', `${hidden.length} listing(s) hidden: ${hidden.map((h) => h.reason).join('; ')}`, 'muted')] : []),
    ...(shown.length ? [] : [el('p', 'No verified listings in this category.', 'muted')]),
  )
}, $('listings'))

$('plan').onclick = () => busy('plan', async () => {
  const c = cfg()
  const out = $<HTMLDivElement>('planOut')
  if (!chosen) throw new Error('pick a model first')
  if (!c.routerKey) throw new Error('add your 0G Private Computer key in settings')
  const file = $<HTMLInputElement>('dataset').files?.[0]
  if (!file) throw new Error('choose your dataset file (it stays in this browser)')
  const rows = (await file.text()).trim().split('\n').map((l) => JSON.parse(l) as { text: string; label: string })
  const summary = localSummary(rows)
  const card = chosen.doc.card as { allowedTargets: string[] }
  const catalog = catalogV1(card)
  const r = await routerLlm({ baseUrl: c.routerUrl, apiKey: c.routerKey }).next([
    { role: 'system', content: systemPrompt(catalog, { maxPlannerCalls: 10, maxGpuSeconds: 300, maxWallClockSec: 1200, maxTrainingRuns: 2 }) },
    { role: 'user', content: `PLANNING ONLY (no tools run yet). Buyer goal: ${JSON.stringify($<HTMLTextAreaElement>('goal').value)}. Card: ${JSON.stringify(chosen.doc.card)}. Data summary: ${JSON.stringify(summary)}. Reply with one propose_recipe call for the first run.` },
  ])
  const plan = JSON.parse(r.text.replace(/^```(json)?|```$/g, '').trim())
  const recipe = validateRecipe(plan.args?.recipe, catalog) // the same policy gate the worker enforces
  out.replaceChildren(
    el('p', 'Sent to the agent: ' + JSON.stringify(summary), 'muted'),
    el('p', `Agent: ${plan.args?.reason ?? ''}`),
    el('pre', JSON.stringify(recipe, null, 2)),
    el('p', `0G Private Computer request ID: ${r.requestId} · private (TEE-only) tier`, 'ok'),
  )
}, $('planOut'))

$('verify').onclick = () => busy('verify', async () => {
  const out = $<HTMLDivElement>('verifyOut')
  const w = new WorkerClient($('workerUrl').value.replace(/\/$/, ''), privateKeyToAccount(generatePrivateKey()))
  const img = chosen ? `sha256:${chosen.doc.offer.workerImageDigest.slice(2)}` : ''
  const v = await verifyWorker(w, { expectedImageDigest: img, requireGpu: false })
  out.replaceChildren(el('p', `✓ worker ${v.evidence.workerAddress} verified: TCB ${v.verdict.tcbStatus}, ${v.verdict.gpus} GPU(s). Keys may be released to it.`, 'ok'))
}, $('verifyOut'))
