// Faultline Studio: Order -> Pay (x402 on Hedera) -> Run -> Results.
// Talks only to the local agent console (packages/hedera/src/agent-console.ts); no keys or permits reach this page.
type Tick = { t_s: number; ego_x: number; ego_v: number; ego_a: number; ego_lat_m: number | null; lead_x: number; lead_v: number
  adv_lat_m: number | null; gt_gap: number; gt_ttc_s: number | null; ttc_s: number | null; lidar_gap: number | null; ccs: number | null; collision: boolean }
type Decision = { cp: number; sim_time_s: number; action: string | null; source: string; reason: string; request_id: string | null
  provider: string | null; latency_ms: number; wall_clock_utc: string; content?: string | null }
type Run = { name: string; jobId: string | null; status: string; world: string | null; family: string | null; decisions: number | null
  decisions0g: number | null; ccs: number | null; minTtc: number | null; minGap: number | null; collision: boolean | null
  chain: { registry: string; commitTx: string; finalizeTx: string | null; onchainMatches: boolean | null; commitBlockTimestamp?: number | null; committedBeforeFirstCall?: boolean | null } | null
  storage: { publicRoot: string; sealedRoot: string; signaturesArchived: number | null; signatures0g: number | null; signaturesVerified?: number | null } | null
  payment: { transaction: string; payer: string; suite: string; hashscan: string } | null; episodeId: string | null; model: string | null; agentId?: number | null; arkivEntity?: string | null; free?: boolean | null }

const C = { ink: '#111111', paper: '#fbfbf6', muted: '#6b6b66', yellow: '#f3f56c', cyan: '#7cecf5', pink: '#f5a3ef', purple: '#7c5cf5', lime: '#c9f36f', hot: '#ff4fc3' }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const esc = (s: unknown) => String(s ?? '—').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const num = (x: unknown, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—')
const short = (s: unknown, a = 8, b = 6) => (typeof s === 'string' && s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : esc(s))
const hbar = (tinybar: number | null | undefined) => (typeof tinybar === 'number' ? (tinybar / 1e8).toFixed(4) : '—')
const risk = (c: number | null | undefined) => (c == null ? { cls: 'l', word: '—' } : c >= 0.75 ? { cls: 'p', word: 'High risk' } : c >= 0.5 ? { cls: 'y', word: 'Medium risk' } : { cls: 'l', word: 'Low risk' })
const kv = (rows: [string, string][]) => rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')
const link = (href: string, text: string) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text} ↗</a>`
const galileoTx = (tx: string) => `https://chainscan-galileo.0g.ai/tx/${tx}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// Set at build time (esbuild --define, FAULTLINE_API_BASE); empty = same origin as the page.
declare const FAULTLINE_API_BASE: string
const API = (typeof FAULTLINE_API_BASE === 'string' ? FAULTLINE_API_BASE : '').replace(/\/$/, '')
const api = (p: string) => API + p
const getJson = (p: string) => fetch(api(p)).then((r) => { if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json() })
const postJson = async (p: string, body: unknown) => {
  const r = await fetch(api(p), { method: 'POST', headers: { 'content-type': 'application/json', 'x-faultline-console': '1' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `${p}: HTTP ${r.status}`)
  return j
}

async function post(path: string, body: unknown, onEvent: (e: any) => void) {
  const r = await fetch(api(path), { method: 'POST', headers: { 'content-type': 'application/json', 'x-faultline-console': '1' }, body: JSON.stringify(body) })
  if (!r.ok || !r.body) throw new Error(`${path}: HTTP ${r.status}`)
  const reader = r.body.getReader(), dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop() ?? ''
    for (const l of lines) if (l.trim()) onEvent(JSON.parse(l))
  }
}

// ---------- navigation ----------
type View = 'featured' | 'ab' | 'order' | 'pay' | 'live' | 'results'
function show(view: View) {
  for (const v of ['featured', 'ab', 'order', 'pay', 'live', 'results']) $(`v-${v}`).classList.toggle('hidden', v !== view)
  document.querySelectorAll<HTMLButtonElement>('nav.steps button').forEach((b) => b.classList.toggle('on', b.dataset.view === view))
  const btn = document.querySelector<HTMLButtonElement>(`nav.steps button[data-view="${view}"]`); if (btn) btn.disabled = false
  window.scrollTo({ top: 0 })
  requestAnimationFrame(resizeAll)
}
document.querySelectorAll<HTMLButtonElement>('nav.steps button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view as any)))

// ---------- order ----------
let catalog: any = null
let suite = 'cut-in-v1-kinematic'
const SUITE: Record<string, { name: string; tag: string; cls: string }> = {
  'cut-in-v1-kinematic': { name: 'Cut-in', tag: 'Kinematic', cls: 'c' },
  'cut-in-v1-carla': { name: 'Cut-in', tag: 'CARLA 0.10', cls: 'y' },
}
async function loadCatalog() {
  catalog = await getJson('/api/catalog')
  $('n-hedera').className = `dot ${catalog.serviceUp ? 'up' : 'down'}`
  $('n-carla').className = `dot ${catalog.carlaUp ? 'up' : 'down'}`
  $('suites').innerHTML = catalog.suites.map((s: any) => {
    const m = SUITE[s.id] ?? { name: s.id, tag: s.simulator, cls: 'c' }
    const off = s.id.endsWith('carla') && !catalog.carlaUp
    return `<button class="suite ${m.cls} ${s.id === suite ? 'on' : ''}" data-suite="${esc(s.id)}">
      <div style="display:flex;gap:6px"><span class="pill sm">${esc(m.tag)}</span>${off ? '<span class="pill sm p">offline</span>' : ''}</div>
      <h3>${esc(m.name)}</h3><canvas data-mini="${esc(s.id)}"></canvas></button>`
  }).join('')
  document.querySelectorAll<HTMLButtonElement>('.suite').forEach((b) => b.addEventListener('click', () => { suite = b.dataset.suite!; loadCatalog() }))
  document.querySelectorAll<HTMLCanvasElement>('canvas[data-mini]').forEach(drawMini)
  $('price').textContent = catalog.service ? (Number(catalog.service.price) / 1e8).toString() : '0.001'
  $('order-kv').innerHTML = kv([
    ['Policy', `<code title="${esc(catalog.policyCommitment)}">PDM-Lite · ${short(catalog.policyCommitment, 8, 4)}</code>`],
    ['Adversary', '0gm-1.0-35b-a3b'],
    ['Runs', '1'],
    ['Payer', `<code>${esc(catalog.payer)}</code> · ${hbar(catalog.payerBalance)} ℏ`],
    ['Cap', `${hbar(Number(catalog.cap))} ℏ`],
  ])
  const blocked = !catalog.serviceUp || !!catalog.cfgError || !!catalog.runnerError || catalog.buysLeft < 1 || (suite.endsWith('carla') && !catalog.carlaUp)
  $<HTMLButtonElement>('hold').disabled = blocked
  $<HTMLButtonElement>('quote').disabled = !catalog.serviceUp || !!catalog.cfgError
  $('order-err').textContent = catalog.cfgError ?? (!catalog.serviceUp ? 'Service offline · npm run hedera:serve' : catalog.runnerError ? `Runner not ready: ${catalog.runnerError}` : '')
  renderPending(catalog.pending ?? [])
  loadRuns()
}
function drawMini(cv: HTMLCanvasElement) {
  const { g, w, h } = setup(cv, 96)
  g.fillStyle = C.ink; g.beginPath(); g.roundRect(0, h * 0.18, w, h * 0.64, 14); g.fill()
  g.strokeStyle = '#ffffff70'; g.lineWidth = 2; g.setLineDash([10, 10]); g.beginPath(); g.moveTo(10, h / 2); g.lineTo(w - 10, h / 2); g.stroke(); g.setLineDash([])
  g.strokeStyle = C.pink; g.lineWidth = 3; g.beginPath(); g.moveTo(w * 0.42, h * 0.34); g.bezierCurveTo(w * 0.56, h * 0.34, w * 0.6, h * 0.66, w * 0.74, h * 0.66); g.stroke()
  carShape(g, w * 0.24, h * 0.66, 46, 20, C.purple); carShape(g, w * 0.42, h * 0.34, 46, 20, C.pink); carShape(g, w * 0.8, h * 0.66, 46, 20, C.pink, true)
}
function renderPending(list: any[]) {
  let el = document.getElementById('pending')
  if (!list.length) { el?.remove(); return }
  if (!el) { el = document.createElement('div'); el.id = 'pending'; el.className = 'card y'; $('suites').after(el) }
  el.innerHTML = `<div class="head"><h2>Paid, not started</h2><span class="pill sm">permit unused</span></div>` + list.map((j) =>
    `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px"><span class="pill sm">${esc(j.suite)}</span><code>${short(j.jobId, 8, 4)}</code>
     <a class="pill sm" href="${esc(j.hashscan)}" target="_blank" rel="noopener">${short(j.transaction, 10, 4)} ↗</a>
     <button class="pill sm k" data-launch="${esc(j.jobId)}" style="margin-left:auto" ${catalog.runnerError ? 'disabled' : ''}>Launch</button></div>`).join('')
  el.querySelectorAll<HTMLButtonElement>('[data-launch]').forEach((b) => b.addEventListener('click', () => launchJob(b.dataset.launch!, b)))
}
async function launchJob(jobId: string, btn?: HTMLButtonElement) {
  if (btn) btn.disabled = true
  const r = await fetch(api('/api/launch'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-faultline-console': '1' }, body: JSON.stringify({ jobId }) })
  const j = await r.json()
  if (!r.ok) { const msg = `${j.error}${j.log ? '\n' + j.log.slice(-6).join('\n') : ''}`; $('pay-err').textContent = msg; $('order-err').textContent = msg; if (btn) btn.disabled = false; return }
  startStream(j.run, 'live')
}
async function loadRuns() {
  const runs: Run[] = await getJson('/api/runs')
  allRuns = runs
  $('runs').innerHTML = runs.map((r) => `<tr><td><code>${short(r.name, 12, 4)}</code></td><td>${esc(r.world)}</td><td>${esc(r.decisions0g)}/${esc(r.decisions)}</td>
    <td><span class="pill sm ${risk(r.ccs).cls}">${num(r.ccs, 3)}</span></td><td>${num(r.minTtc)} s</td><td>${r.payment ? '<span class="pill sm p">ℏ</span>' : ''}</td>
    <td style="text-align:right"><button class="pill sm k" data-replay="${esc(r.name)}">Replay</button></td></tr>`).join('') ||
    '<tr><td colspan="7" class="muted">No runs yet</td></tr>'
  document.querySelectorAll<HTMLButtonElement>('[data-replay]').forEach((b) => b.addEventListener('click', () => startStream(b.dataset.replay!, 'replay')))
}

// hold-to-pay: a deliberate 1.2 s press; release cancels
let holdT = 0, holdRaf = 0
const hold = $<HTMLButtonElement>('hold')
hold.addEventListener('pointerdown', () => {
  if (hold.disabled) return
  holdT = performance.now()
  const step = () => {
    const p = Math.min((performance.now() - holdT) / 1200, 1)
    ;(hold.querySelector('.fill') as HTMLElement).style.width = `${p * 100}%`
    if (p >= 1) { holdT = 0; startPay('pay').catch(payFail); return }
    if (holdT) holdRaf = requestAnimationFrame(step)
  }
  holdRaf = requestAnimationFrame(step)
})
const cancelHold = () => { if (!holdT) return; holdT = 0; cancelAnimationFrame(holdRaf); (hold.querySelector('.fill') as HTMLElement).style.width = '0' }
hold.addEventListener('pointerup', cancelHold); hold.addEventListener('pointerleave', cancelHold)
const payFail = (e: unknown) => { $('pay-err').textContent = String((e as Error)?.message ?? e) }
$('quote').addEventListener('click', () => startPay('quote').catch(payFail))

// ---------- pay ----------
const PAY_STEPS: [string, string][] = [['discover', 'Discover'], ['quote', '402 quote'], ['facilitator', 'Facilitator'],
  ['policy', 'Spending policy'], ['settle', 'Sign & settle'], ['mirror', 'Consensus'], ['bind', 'Bind to request'], ['activate', 'Permit']]
let job: any = null
function flowSvg() {
  $('flow').innerHTML = `
    <path id="p-req" d="M250 80 C 420 30, 580 30, 750 80" stroke="#111" stroke-opacity=".35" stroke-width="2" fill="none" stroke-dasharray="4 8"/>
    <path id="p-quote" d="M750 110 C 580 160, 420 160, 250 110" stroke="#111" stroke-opacity=".35" stroke-width="2" fill="none" stroke-dasharray="4 8"/>
    <path id="p-pay" d="M250 130 C 380 250, 440 330, 500 330 C 560 330, 620 250, 750 130" stroke="#111" stroke-width="2" fill="none"/>
    <g id="pk"></g>`
}
function packet(pathId: string, label: string, fill: string, ms = 900) {
  const path = document.getElementById(pathId) as unknown as SVGPathElement
  const g = document.getElementById('pk')!
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const w = Math.max(40, label.length * 8 + 24)
  el.innerHTML = label === 'ℏ'
    ? `<circle r="20" fill="${C.yellow}" stroke="#111" stroke-width="2"/><text text-anchor="middle" dy="7" font-size="20" font-weight="700" fill="#111" font-family="Space Grotesk">ℏ</text>`
    : `<rect x="${-w / 2}" y="-14" width="${w}" height="28" rx="14" fill="${fill}" stroke="#111" stroke-width="1.5"/><text text-anchor="middle" dy="5" font-size="13" font-weight="600" fill="#111" font-family="Space Grotesk">${label}</text>`
  g.appendChild(el)
  const L = path.getTotalLength(), t0 = performance.now()
  return new Promise<void>((done) => {
    const f = () => {
      const p = Math.min((performance.now() - t0) / ms, 1), e = 1 - (1 - p) ** 3
      const pt = path.getPointAtLength(e * L)
      el.setAttribute('transform', `translate(${pt.x},${pt.y})`)
      if (p < 1) requestAnimationFrame(f); else { el.remove(); done() }
    }
    requestAnimationFrame(f)
  })
}
function countTo(el: HTMLElement, from: number, to: number, ms = 900) {
  const t0 = performance.now()
  const f = () => { const p = Math.min((performance.now() - t0) / ms, 1); el.textContent = `${((from + (to - from) * (1 - (1 - p) ** 3)) / 1e8).toFixed(4)} ℏ`; if (p < 1) requestAnimationFrame(f) }
  requestAnimationFrame(f)
}
async function startPay(mode: 'quote' | 'pay') {
  if (!catalog) return
  show('pay'); flowSvg()
  $('paysteps').innerHTML = PAY_STEPS.map(([id, t]) => `<li id="ps-${id}"><i class="ic"></i><div><div class="t">${t}</div><div class="d"></div></div><span class="ms"></span></li>`).join('')
  $('checks').innerHTML = ''; $('pay-err').textContent = ''; $('ticket').classList.remove('show')
  $('pay-mode').textContent = mode === 'quote' ? 'quote only' : 'x402'
  $('payer-id').textContent = catalog.payer; $('merchant-id').textContent = catalog.merchant
  $('payer-bal').textContent = `${hbar(catalog.payerBalance)} ℏ`; $('merchant-bal').textContent = `${hbar(catalog.merchantBalance)} ℏ`
  $('payer-delta').textContent = ''; $('merchant-delta').textContent = ''; $('ledger-v').textContent = 'Hedera testnet'
  const timers = new Map<string, number>()
  try {
    await post('/api/buy', { suite, mode }, (e) => {
      if (e.t === 'step') {
        const li = $(`ps-${e.id}`); if (!li) return
        li.querySelector('.ic')!.className = `ic ${e.status}`
        li.querySelector('.d')!.textContent = e.status === 'fail' ? '' : e.detail ?? ''
        if (e.status === 'run') {
          const t0 = performance.now()
          timers.set(e.id, window.setInterval(() => { li.querySelector('.ms')!.textContent = `${((performance.now() - t0) / 1000).toFixed(1)}s` }, 100))
          if (e.id === 'quote') packet('p-req', 'POST', C.paper)
          if (e.id === 'settle') packet('p-pay', 'ℏ', C.yellow, 2000)
          if (e.id === 'activate') packet('p-quote', 'permit', C.pink, 1000)
        } else {
          clearInterval(timers.get(e.id)); li.querySelector('.ms')!.textContent = e.ms != null ? `${e.ms} ms` : ''
        }
        if (e.status === 'ok' && e.id === 'quote') packet('p-quote', '402 · 0.001 ℏ', C.yellow)
        if (e.status === 'ok' && e.id === 'policy') {
          const rows = (e.data?.checks ?? []) as { label: string; pass: boolean }[]
          $('checks').innerHTML = rows.map((c) => `<span class="pill sm ${c.pass ? 'l' : 'p'}">${esc(c.label)}</span>`).join('')
          ;[...$('checks').children].forEach((el, i) => setTimeout(() => el.classList.add('on'), 90 * i))
        }
        if (e.status === 'ok' && e.id === 'settle') { $('ledger-v').innerHTML = `<code>${esc(e.data?.transaction)}</code>`; $('ledger').classList.remove('flash'); void $('ledger').offsetWidth; $('ledger').classList.add('flash') }
        if (e.status === 'ok' && e.id === 'mirror') {
          for (const t of (e.data?.transfers ?? []) as { account: string; amount: number }[]) {
            const side = t.account === catalog.payer ? 'payer' : 'merchant'
            const base = side === 'payer' ? catalog.payerBalance : catalog.merchantBalance
            if (typeof base === 'number') countTo($(`${side}-bal`), base, base + t.amount)
            $(`${side}-delta`).textContent = `${t.amount > 0 ? '+' : ''}${t.amount.toLocaleString()} tinybar`
          }
        }
        if (e.status === 'fail') $('pay-err').textContent = `${e.title}: ${e.detail}`
      }
      if (e.t === 'error') $('pay-err').textContent = e.message
      if (e.t === 'done' && e.quoteOnly) $('ledger-v').textContent = 'Ready to pay'
      if (e.t === 'done' && e.job) { job = e.job; showTicket(e.job) }
    })
  } finally { timers.forEach((t) => clearInterval(t)) }
}
function showTicket(j: any) {
  $('t-job').textContent = j.jobId
  $('t-kv').innerHTML = kv([['Suite', `<code>${esc(j.suite)}</code>`], ['Transaction', `<code>${short(j.transaction, 12, 8)}</code>`],
    ['Expires', esc(new Date(j.expiresAt).toLocaleString())]])
  $<HTMLAnchorElement>('t-hashscan').href = j.hashscan
  const cv = $<HTMLCanvasElement>('pattern'), g = cv.getContext('2d')!, pal = [C.ink, C.yellow, C.cyan, C.paper]
  for (let i = 0; i < 64; i++) { g.fillStyle = pal[parseInt(j.jobId[i % 32], 16) % 4]; g.fillRect(i % 8, (i / 8) | 0, 1, 1) }
  requestAnimationFrame(() => $('ticket').classList.add('show'))
}
$('launch').addEventListener('click', () => { if (job) launchJob(job.jobId, $<HTMLButtonElement>('launch')) })

// ---------- run ----------
let ticks: Tick[] = [], decisions: Decision[] = [], runMeta: Run | null = null, allRuns: Run[] = []
let waiting: { cp: number; t0: number } | null = null, flashUntil = 0, flashAction = ''
const TL: [string, string][] = [['payment', 'Paid'], ['permit', 'Permit'], ['commit', 'Committed'], ['sim', 'Simulation'],
  ['decisions', '0G decisions'], ['storage', 'Stored'], ['finalize', 'Finalized'], ['report', 'Report']]
function timeline(id: string, status: string, detail = '') {
  const li = $(`tl-${id}`); if (!li) return
  li.querySelector('.ic')!.className = `ic ${status}`
  if (detail) li.querySelector('.d')!.innerHTML = detail
}
const logLine = (s: string) => { const el = $('log'); el.textContent += s + '\n'; el.scrollTop = el.scrollHeight }
async function startStream(run: string, mode: 'live' | 'replay', by: 'run' | 'job' = 'run', free = false) {
  show('live')
  ticks = []; decisions = []; waiting = null; runMeta = null; runFree = free; renderRails()
  $('timeline').innerHTML = TL.map(([id, t]) => `<li id="tl-${id}"><i class="ic"></i><div><div class="t">${t}</div><div class="d"></div></div></li>`).join('')
  $('tower').innerHTML = ''; $('log').textContent = ''; $('to-results').classList.add('hidden')
  $('live-tag').textContent = mode === 'live' ? 'Live' : 'Replay'; $('live-tag').classList.add('live')
  $('s-job').textContent = '—'; $('s-dec').textContent = '0'
  try {
    await post('/api/stream', { [by]: run, mode, speed: mode === 'replay' ? 2 : 1 }, (e) => {
      if (e.t === 'meta') { runMeta = e.run; renderRails(); $('s-job').textContent = e.run.jobId ? `job ${short(e.run.jobId, 6, 4)}` : short(e.run.name, 10, 4); $('s-world').textContent = e.run.world ?? '—' }
      if (e.t === 'phase') {
        const d = e.data ?? {}
        logLine(`${e.status === 'ok' ? '✓' : '·'} ${e.title}`)
        const det = d.hashscan ? link(d.hashscan, short(d.transaction, 10, 4)) : d.tx ? link(galileoTx(d.tx), short(d.tx, 8, 4)) :
          d.publicRoot ? `${short(d.publicRoot, 8, 4)} · ${d.signatures_archived ?? d.signaturesArchived ?? '—'} sigs` : d.jobId ? short(d.jobId, 8, 4) : d.ticks ? `${d.ticks} ticks` : ''
        timeline(e.id, e.status, det)
        if (e.id === 'sim' && e.status === 'run') timeline('decisions', 'run', '0')
        if (e.id === 'sim' && e.status === 'ok') timeline('decisions', 'ok', `${decisions.filter((x) => x.source === '0g').length}/${decisions.length}`)
      }
      if (e.t === 'await0g' && (!waiting || waiting.cp !== e.cp)) { waiting = { cp: e.cp, t0: performance.now() }; renderTower() }
      if (e.t === 'idle' && waiting) { waiting = null; renderTower() }
      if (e.t === 'decision') {
        logLine(`0G cp${e.d.cp} ${e.d.action ?? 'SAFE_HALT'} ${e.d.latency_ms}ms ${e.d.request_id}`)
        decisions.push(e.d); waiting = null; flashUntil = performance.now() + 1200; flashAction = e.d.action ?? 'SAFE_HALT'
        $('s-dec').textContent = String(decisions.length); timeline('decisions', 'run', String(decisions.length)); renderTower(true); renderRails()
      }
      if (e.t === 'ticks') { ticks.push(...e.rows); const r = ticks.at(-1)!; $('s-t').textContent = `${num(r.t_s)} s`; $('s-gap').textContent = `${num(r.gt_gap, 1)} m`; $('s-ttc').textContent = r.gt_ttc_s == null ? '∞' : `${num(r.gt_ttc_s, 2)} s` }
      if (e.t === 'log') logLine(e.line)
      if (e.t === 'queue') $('s-job').textContent = `queue #${e.pos ?? '—'}${e.etaS != null ? ` · ETA ${Math.round(e.etaS)} s` : ''}`
      if (e.t === 'done' || e.t === 'error') {
        waiting = null; renderTower()
        if (e.run) runMeta = e.run
        renderRails()
        timeline('report', e.t === 'done' ? 'ok' : 'fail', e.t === 'done' ? `CCS ${num(e.run?.ccs, 3)}` : esc(e.message))
        $('live-tag').textContent = e.t === 'done' ? 'Done' : 'Stopped'; $('live-tag').classList.remove('live')
        $('to-results').classList.remove('hidden')
        if (e.t === 'done') setTimeout(() => openResults(), 1200)
      }
    })
  } catch (err) { logLine((err as Error).message) }
}
function renderTower(fresh = false) {
  const rows = decisions.slice().reverse().map((d, i) => `<div class="row ${fresh && i === 0 ? 'new' : ''}"><span>${String(d.cp).padStart(2, '0')}</span>
    <span><span class="act ${esc(d.action ?? 'SAFE_HALT')}">${esc(d.action ?? 'SAFE_HALT')}</span></span>
    <span>${d.latency_ms} ms</span><span></span><span class="sub">${short(d.request_id, 8, 4)} · ${num(d.sim_time_s, 1)} s${d.source === '0g' ? '' : ' · ' + esc(d.source)}</span>${d.content ? `<span class="sub" style="color:#111">${esc(d.content)}</span>` : ''}</div>`).join('')
  $('tower').innerHTML = (waiting ? `<div class="row wait"><span>${String(waiting.cp).padStart(2, '0')}</span><span>waiting for 0G</span><span id="wait-ms">…</span></div>` : '') + rows
}
$('to-results').addEventListener('click', () => openResults())

// ---------- drawing ----------
function setup(cv: HTMLCanvasElement, hCss?: number) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, h = hCss ?? r.height
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(h * dpr))
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { g, w: r.width, h }
}
function carShape(g: CanvasRenderingContext2D, cx: number, cy: number, lw: number, cw: number, fill: string, ghost = false) {
  g.globalAlpha = ghost ? 0.35 : 1
  g.fillStyle = fill; g.strokeStyle = C.ink; g.lineWidth = 2
  g.beginPath(); g.roundRect(cx - lw / 2, cy - cw / 2, lw, cw, Math.min(8, cw / 2.5)); g.fill(); g.stroke()
  g.fillStyle = C.ink; g.beginPath(); g.roundRect(cx + lw * 0.08, cy - cw * 0.32, lw * 0.2, cw * 0.64, 3); g.fill()
  g.globalAlpha = 1
}
function pillAt(g: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, font = '600 12px "Space Grotesk", sans-serif') {
  g.font = font; const w = g.measureText(text).width + 20, h = 24
  g.fillStyle = fill; g.strokeStyle = C.ink; g.lineWidth = 1.5
  g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, 12); g.fill(); g.stroke()
  g.fillStyle = C.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 0.5); g.textAlign = 'left'; g.textBaseline = 'alphabetic'
}
const ttcFill = (t: number | null) => (t == null || t >= 3 ? C.lime : t >= 1.5 ? C.yellow : C.pink)
function drawScene(cv: HTMLCanvasElement, r: Tick | undefined, trail: Tick[], label?: string, pulse = 0) {
  const { g, w, h } = setup(cv)
  const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, C.cyan); bg.addColorStop(1, C.lime)
  g.fillStyle = bg; g.fillRect(0, 0, w, h)
  if (!r) { pillAt(g, w / 2, h / 2, 'Waiting for the first tick', C.paper); return }
  const span = 48, ppm = w / span, x0 = r.ego_x - span * 0.28, laneW = 3.5
  const vpm = Math.min(ppm * 1.6, (h - 120) / (laneW * 2)), Y = (lat: number) => h / 2 - (lat - laneW / 2) * vpm
  const X = (x: number) => (x - x0) * ppm
  const top = Y(laneW * 1.5), bot = Y(-laneW / 2)
  g.fillStyle = C.ink; g.beginPath(); g.roundRect(-10, top, w + 20, bot - top, 0); g.fill()
  g.strokeStyle = '#ffffff80'; g.lineWidth = 2; g.setLineDash([3 * ppm, 3 * ppm]); g.lineDashOffset = (r.ego_x * ppm) % (6 * ppm)
  g.beginPath(); g.moveTo(0, Y(laneW / 2)); g.lineTo(w, Y(laneW / 2)); g.stroke(); g.setLineDash([])
  g.strokeStyle = C.pink; g.lineWidth = 3; g.globalAlpha = .6; g.beginPath()
  trail.forEach((p, i) => { const x = X(p.lead_x), y = Y(p.adv_lat_m ?? 0); i ? g.lineTo(x, y) : g.moveTo(x, y) }); g.stroke(); g.globalAlpha = 1
  const egoFront = r.ego_x + 2.45, advRear = r.lead_x - 2.35
  g.strokeStyle = C.paper; g.lineWidth = 2; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(egoFront), Y(r.ego_lat_m ?? 0)); g.lineTo(X(advRear), Y(r.adv_lat_m ?? 0)); g.stroke(); g.setLineDash([])
  const lw = (len: number) => len * ppm, cw = Math.min(1.9 * vpm, lw(4.8) * 0.45)
  carShape(g, X(r.ego_x), Y(r.ego_lat_m ?? 0), lw(4.9), cw, C.purple)
  carShape(g, X(r.lead_x), Y(r.adv_lat_m ?? 0), lw(4.7), cw, r.collision ? C.hot : C.pink)
  pillAt(g, X(r.ego_x), bot + 22, `You · ${num(r.ego_v * 3.6, 0)} km/h`, C.paper)
  pillAt(g, X(r.lead_x), top - 22, `0G · ${num(r.lead_v * 3.6, 0)} km/h`, C.pink)
  pillAt(g, w - 110, 28, `${num(r.gt_gap, 1)} m · TTC ${r.gt_ttc_s == null ? '∞' : num(r.gt_ttc_s, 2) + ' s'}`, ttcFill(r.gt_ttc_s), '600 13px "JetBrains Mono", monospace')
  if (pulse > 0 && label) { g.globalAlpha = Math.min(1, pulse * 1.6); pillAt(g, X(r.lead_x), top - 54, label, C.yellow, '700 14px "Space Grotesk", sans-serif'); g.globalAlpha = 1 }
  if (r.collision) pillAt(g, 90, 28, 'Collision', C.hot, '700 14px "Space Grotesk", sans-serif')
}
function drawTele(cv: HTMLCanvasElement, rows: Tick[], ds: Decision[], cursor?: number) {
  const { g, w, h } = setup(cv)
  g.clearRect(0, 0, w, h)
  const T = Math.max(rows.at(-1)?.t_s ?? 1, 1), pad = 8, top = 30, X = (t: number) => pad + (t / T) * (w - pad * 2), Yv = (v: number, max: number) => top + (1 - Math.min(v, max) / max) * (h - top - 18)
  g.strokeStyle = '#1111111a'; g.lineWidth = 1
  for (let i = 0; i <= 3; i++) { const y = top + i * (h - top - 18) / 3; g.beginPath(); g.moveTo(pad, y); g.lineTo(w - pad, y); g.stroke() }
  g.beginPath(); let started = false
  for (const r of rows) { const y = Yv(r.ccs ?? 0, 1); started ? g.lineTo(X(r.t_s), y) : g.moveTo(X(r.t_s), y); started = true }
  if (rows.length) { g.lineTo(X(rows.at(-1)!.t_s), Yv(0, 1)); g.lineTo(X(rows[0].t_s), Yv(0, 1)); g.closePath(); g.fillStyle = C.pink; g.fill(); g.strokeStyle = C.ink; g.lineWidth = 1.5; g.stroke() }
  const line = (val: (r: Tick) => number | null, max: number, color: string, wdt: number) => {
    g.strokeStyle = color; g.lineWidth = wdt; g.beginPath(); let pen = false
    for (const r of rows) { const v = val(r); if (v == null) { pen = false; continue } pen ? g.lineTo(X(r.t_s), Yv(v, max)) : g.moveTo(X(r.t_s), Yv(v, max)); pen = true }
    g.stroke()
  }
  line((r) => r.gt_gap, 30, C.purple, 2.5)
  line((r) => r.gt_ttc_s, 6, C.ink, 2)
  for (const d of ds) { g.fillStyle = d.source === 'none' ? C.hot : C.ink; g.beginPath(); g.arc(X(d.sim_time_s), h - 8, 3.5, 0, Math.PI * 2); g.fill() }
  if (cursor != null) { g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(cursor), top - 6); g.lineTo(X(cursor), h - 14); g.stroke() }
  let lx = pad; g.font = '500 12px "Space Grotesk", sans-serif'
  for (const [c, t] of [[C.pink, 'CCS'], [C.purple, 'Gap 0–30 m'], [C.ink, 'TTC 0–6 s'], [C.ink, '0G decision']] as const) {
    const tw = g.measureText(t).width; g.fillStyle = c === C.ink ? C.ink : c; g.beginPath(); g.roundRect(lx, 4, 10, 10, 5); g.fill(); g.fillStyle = C.ink; g.fillText(t, lx + 14, 13); lx += tw + 30
  }
}
function drawGauge(cv: HTMLCanvasElement, v: number | null) {
  const { g, w, h } = setup(cv), cx = w / 2, cy = h - 22, R = Math.min(w / 2, h) - 18
  g.clearRect(0, 0, w, h)
  const x = Math.max(0, Math.min(v ?? 0, 1))
  g.lineCap = 'round'; g.lineWidth = 16; g.strokeStyle = '#11111114'; g.beginPath(); g.arc(cx, cy, R, Math.PI, 2 * Math.PI); g.stroke()
  g.strokeStyle = x >= 0.75 ? C.pink : x >= 0.5 ? C.yellow : C.lime; g.beginPath(); g.arc(cx, cy, R, Math.PI, Math.PI + Math.max(0.001, x) * Math.PI); g.stroke()
  g.lineWidth = 1.5; g.strokeStyle = C.ink; g.lineCap = 'butt'
  g.fillStyle = C.ink; g.textAlign = 'center'; g.font = '600 30px "Space Grotesk", sans-serif'; g.fillText(num(v, 2), cx, cy - 4)
  g.font = '500 12px "Space Grotesk", sans-serif'; g.fillStyle = C.muted; g.fillText('Peak CCS', cx, cy + 16); g.textAlign = 'left'
}

// ---------- results ----------
let worstIdx = 0
function openResults() {
  show('results')
  const r = runMeta
  worstIdx = ticks.reduce((m, t, i) => ((t.ccs ?? 0) > (ticks[m]?.ccs ?? 0) ? i : m), 0)
  const at = ticks[worstIdx], cause = decisions.filter((d) => d.sim_time_s < (at?.t_s ?? 0)).at(-1)
  const k = risk(r?.ccs)
  $('verdict').innerHTML = `<span class="pill big ${k.cls}">${k.word}</span><span class="pill big">CCS ${num(r?.ccs, 2)}</span>
    <span class="pill c">Min TTC ${num(r?.minTtc)} s</span><span class="pill">Min gap ${num(r?.minGap)} m</span>
    <span class="pill ${r?.collision ? 'p' : 'l'}">${r?.collision ? 'Collision' : 'No collision'}</span>
    <span class="pill y">Worst at ${num(at?.t_s)} s${cause ? ` · after ${esc(cause.action)}` : ''}</span>`
  const s = $<HTMLInputElement>('scrub'); s.max = String(Math.max(0, ticks.length - 1)); s.value = String(worstIdx)
  drawResults()
  const p = r?.payment
  $('ev-h').innerHTML = p ? kv([['Transaction', link(p.hashscan, short(p.transaction, 12, 6))], ['Payer', `<code>${esc(p.payer)}</code>`], ['Suite', `<code>${esc(p.suite)}</code>`], ['Job', `<code>${short(r?.jobId, 8, 6)}</code>`]])
    : kv([['Payment', 'none']])
  const st = r?.storage, ch = r?.chain
  $('ev-z').innerHTML = kv([
    ['Model', `<code>${esc(r?.model)}</code>`],
    ['Decisions', `${decisions.filter((d) => d.source === '0g').length}/${decisions.length}`],
    ['Signatures', st ? `${esc(st.signaturesArchived)}/${esc(st.signatures0g)} archived` : '—'],
    ['Public root', st ? `<code title="${esc(st.publicRoot)}">${short(st.publicRoot, 8, 4)}</code>` : '—'],
    ['Commit', ch ? link(galileoTx(ch.commitTx), short(ch.commitTx, 8, 4)) : '—'],
    ['Finalize', ch?.finalizeTx ? `${link(galileoTx(ch.finalizeTx), short(ch.finalizeTx, 8, 4))}${ch.onchainMatches ? ' ✓' : ''}` : '—'],
  ])
  renderCompare()
}
function drawResults() {
  const i = Number($<HTMLInputElement>('scrub').value), r = ticks[i]
  drawScene($<HTMLCanvasElement>('rscene'), r, ticks.slice(Math.max(0, i - 120), i + 1), decisions.filter((d) => d.sim_time_s <= (r?.t_s ?? 0)).at(-1)?.action ?? undefined, 0.8)
  drawTele($<HTMLCanvasElement>('rtele'), ticks, decisions, r?.t_s)
  $('scrub-t').textContent = `${num(r?.t_s)} s`
}
$('scrub').addEventListener('input', drawResults)
$('worst').addEventListener('click', async () => {
  const s = $<HTMLInputElement>('scrub'), from = Math.max(0, worstIdx - 60)
  for (let i = from; i <= worstIdx; i++) { s.value = String(i); drawResults(); await sleep(20) }
})
function renderCompare() {
  let el = document.getElementById('compare')
  if (!el) { el = document.createElement('div'); el.id = 'compare'; el.className = 'card'; $('v-results').querySelector('.grid')!.appendChild(el) }
  const base = runMeta?.ccs ?? null
  el.innerHTML = `<div class="head"><h2>Compare</h2><span class="pill sm">same policy</span></div>
    <table><thead><tr><th>Run</th><th>World</th><th>Peak CCS</th><th>Δ</th><th>Min TTC</th><th>Min gap</th><th></th></tr></thead><tbody>${
    allRuns.slice().sort((a, b) => (b.ccs ?? 0) - (a.ccs ?? 0)).map((x) => {
      const d = base != null && x.ccs != null ? x.ccs - base : null, self = x.name === runMeta?.name
      return `<tr><td><code>${short(x.name, 12, 4)}</code>${self ? ' <span class="pill sm k">this</span>' : ''}</td><td>${esc(x.world)}</td>
      <td><span class="pill sm ${risk(x.ccs).cls}">${num(x.ccs, 3)}</span></td>
      <td class="mono">${d == null || self ? '—' : (d > 0 ? '+' : '') + num(d, 3)}</td>
      <td>${num(x.minTtc)} s</td><td>${num(x.minGap)} m</td>
      <td style="text-align:right"><button class="pill sm k" data-replay2="${esc(x.name)}">Replay</button></td></tr>` }).join('')}</tbody></table>`
  el.querySelectorAll<HTMLButtonElement>('[data-replay2]').forEach((b) => b.addEventListener('click', () => startStream(b.dataset.replay2!, 'replay')))
}

// ---------- loop ----------
function frame() {
  if (!$('v-live').classList.contains('hidden')) {
    const r = ticks.at(-1), now = performance.now()
    drawScene($<HTMLCanvasElement>('scene'), r, ticks.slice(-160), flashAction, Math.max(0, (flashUntil - now) / 1200))
    drawTele($<HTMLCanvasElement>('tele'), ticks, decisions)
    drawGauge($<HTMLCanvasElement>('gauge'), ticks.reduce<number | null>((m, t) => (t.ccs != null && (m == null || t.ccs > m) ? t.ccs : m), null))
    const wm = document.getElementById('wait-ms'); if (wm && waiting) wm.textContent = `${((now - waiting.t0) / 1000).toFixed(1)}s`
  }
  requestAnimationFrame(frame)
}
function resizeAll() {
  if (!$('v-results').classList.contains('hidden') && ticks.length) drawResults()
  if (!$('v-order').classList.contains('hidden')) document.querySelectorAll<HTMLCanvasElement>('canvas[data-mini]').forEach(drawMini)
}
window.addEventListener('resize', resizeAll)
requestAnimationFrame(frame)
loadCatalog().catch((e) => { $('order-err').textContent = `Console unreachable: ${(e as Error).message}` })

// ---------- trust rail: which network proved what (fail-closed: a light is green only when the data proves it) ----------
type Trust = { decisions0g?: number | null; decisions?: number | null; requestId?: string | null; provider?: string | null
  sigsVerified?: number | null; sigsTotal?: number | null; sigsArchived?: number | null; publicRoot?: string | null; sealedRoot?: string | null
  commitTx?: string | null; finalizeTx?: string | null; onchainMatches?: boolean | null; commitBeforeFirst?: boolean | null; registry?: string | null
  agentId?: number | null; hedera?: { transaction: string; hashscan: string } | null; arkiv?: string | null; free?: boolean; note?: string }
const ERC8004 = '0x8004A818BFB912233c491871b3d84c89A494BD9e'
const galileoAddr = (a: string) => `https://chainscan-galileo.0g.ai/address/${a}`
let runFree = false
function trustFromRun(r: Run | null, ds: Decision[], free = false): Trust {
  const zg = ds.filter((d) => d.source === '0g'), first = zg[0]
  const ch = r?.chain, st = r?.storage
  // commit-before-first-call: the console's boolean, or recomputed here from the commit block time and the first 0G call
  const cbf = ch?.committedBeforeFirstCall ?? (ch?.commitBlockTimestamp && first?.wall_clock_utc ? ch.commitBlockTimestamp * 1000 < Date.parse(first.wall_clock_utc) : null)
  return { decisions0g: zg.length || r?.decisions0g, decisions: ds.length || r?.decisions, requestId: first?.request_id, provider: first?.provider,
    sigsVerified: st?.signaturesVerified ?? null, sigsTotal: st?.signatures0g ?? null, sigsArchived: st?.signaturesArchived ?? null,
    publicRoot: st?.publicRoot, sealedRoot: st?.sealedRoot, commitTx: ch?.commitTx, finalizeTx: ch?.finalizeTx, onchainMatches: ch?.onchainMatches,
    commitBeforeFirst: cbf, registry: ch?.registry, agentId: r?.agentId ?? null, hedera: r?.payment ? { transaction: r.payment.transaction, hashscan: r.payment.hashscan } : null,
    arkiv: r?.arkivEntity ?? null, free: free || !!r?.free }
}
function railHtml(t: Trust) {
  type S = 'up' | 'part' | 'down' | ''
  const pill = (s: S, net: string, body: string, href?: string | null) => {
    const inner = `<i class="dot ${s}"></i><b>${net}</b> <small>${body}</small>${href ? ' ↗' : ''}`
    return href ? `<a class="pill tp" href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>` : `<span class="pill tp">${inner}</span>`
  }
  const sigOk = t.sigsVerified != null && t.sigsTotal != null && t.sigsTotal > 0 && t.sigsVerified === t.sigsTotal
  const sig = sigOk ? `sig ✓ ${t.sigsVerified}/${t.sigsTotal}` : t.sigsArchived != null ? `sigs archived ${t.sigsArchived}/${t.sigsTotal ?? '—'} · not checked here` : 'sigs —'
  const has0g = (t.decisions0g ?? 0) > 0 && !!t.requestId
  const out = [
    pill(has0g ? (sigOk ? 'up' : 'part') : '', '0G Private Computer', has0g ? `${t.decisions0g}/${t.decisions ?? '—'} decisions · req ${short(t.requestId, 8, 4)}${t.provider ? ` · TEE ${short(t.provider, 6, 4)}` : ''} · ${sig}` : esc(t.note ?? 'no 0G decisions yet')),
    pill(t.publicRoot ? 'up' : '', '0G Storage', t.publicRoot ? `public ${short(t.publicRoot, 8, 4)}${t.sealedRoot ? ` · sealed ${short(t.sealedRoot, 8, 4)}` : ''}` : t.free ? 'free run · not stored' : 'not published'),
    pill(t.onchainMatches === false || t.commitBeforeFirst === false ? 'down' : t.onchainMatches && t.commitBeforeFirst ? 'up' : t.commitTx ? 'part' : '', '0G Galileo',
      t.commitTx ? `commit before 1st decision ${t.commitBeforeFirst === true ? '✓' : t.commitBeforeFirst === false ? '✗' : '—'} · finalize ${t.onchainMatches === true ? '✓' : t.onchainMatches === false ? '✗' : '—'}${t.registry ? ` · ${short(t.registry, 6, 4)}` : ''}` : t.free ? 'free run · not anchored' : 'not anchored',
      t.commitTx ? galileoTx(t.commitTx) : null),
    pill(t.agentId != null ? 'up' : '', 'ERC-8004', `agent #${t.agentId ?? 579}`, galileoAddr(ERC8004)),
    pill(t.hedera ? 'up' : '', 'Hedera x402', t.hedera ? `receipt ${short(t.hedera.transaction, 10, 6)}` : t.free ? 'free run · no payment' : 'no payment', t.hedera?.hashscan),
    pill(t.arkiv ? 'up' : '', 'Arkiv', t.arkiv ? `claim ${short(t.arkiv, 8, 4)}` : 'no claim'),
  ]
  if (t.free) out.unshift('<span class="pill tp y"><b>Free demo</b> <small>real 0G decisions · no payment · not anchored</small></span>')
  if (t.finalizeTx) out.push(`<a class="pill sm" href="${esc(galileoTx(t.finalizeTx))}" target="_blank" rel="noopener">finalize tx ↗</a>`)
  return out.join('')
}
function renderRails() {
  const h = railHtml(trustFromRun(runMeta, decisions, runFree))
  $('rail-live').innerHTML = h; $('rail-results').innerHTML = h
}

// ---------- health ----------
let online = false
async function health() {
  try {
    const h = await getJson('/api/health')
    online = !!h.ok
    $('n-hedera').className = `dot ${h.hedera ? 'up' : 'down'}`; $('n-zg').className = `dot ${h.zg ? 'up' : 'down'}`; $('n-carla').className = `dot ${h.carla ? 'up' : 'down'}`
    $('n-queue').textContent = `Queue ${h.queue?.running ?? 0}▶ ${h.queue?.waiting ?? 0}⏸ · runs left ${h.caps?.runs_left ?? '—'}`
  } catch { online = false; for (const id of ['n-hedera', 'n-zg', 'n-carla']) $(id).className = 'dot down'; $('n-queue').textContent = 'Queue —' }
  $('offline').classList.toggle('hidden', online)
}

// ---------- policies ----------
type Policy = { id: string; name: string; description: string; digest: string; compatible: boolean | null; check?: string }
// Shown only while the console is offline; values from docs/evidence/faultline-stack-bridge.md (checker output, 2026-11-07).
const POLICIES_RECORDED: Policy[] = [
  { id: 'pdm-lite', name: 'PDM-Lite (LiDAR)', description: 'CARLA Leaderboard rule-based planner on its own LiDAR tracks', digest: '0x537db480f1840d95832fa2b2bd855075ad45b5f4cafb7b64f9eed6c2dd266bba', compatible: true, check: 'recorded: stacks/pdm_lite.yaml → COMPATIBLE (8/8 checks)' },
  { id: 'idm-cautious', name: 'Cautious IDM (1.6 s headway)', description: 'Intelligent Driver Model, 1.6 s time headway, LiDAR gap', digest: '0x7a2bf614…0097', compatible: true, check: 'recorded: stacks/idm_lidar.yaml → COMPATIBLE' },
]
let policies: Policy[] = POLICIES_RECORDED, policiesLive = false, policy = 'pdm-lite'
async function loadPolicies() {
  try { const p = await getJson('/api/policies'); if (Array.isArray(p) && p.length) { policies = p; policiesLive = true } } catch { /* recorded list stays */ }
  const opts = policies.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
  $('ab-a').innerHTML = opts; $('ab-b').innerHTML = opts
  if (policies[1]) $<HTMLSelectElement>('ab-b').value = policies[1].id
}
const BYO = 'https://github.com/Soni-Shivam/Pivot_HTE/blob/main/docs/INTEGRATE_YOUR_STACK.md'

// ---------- media: the console serves /media/<path>; recorded clips fall back to the public repo when it is offline ----------
const RAW = 'https://raw.githubusercontent.com/Soni-Shivam/Pivot_HTE/main/'
const video = (path: string) => `<video controls muted playsinline preload="metadata" src="${esc(api('/media/' + path))}" data-fallback="${esc(RAW + path)}"></video>`
document.addEventListener('error', (e) => {
  const v = e.target as HTMLVideoElement
  if (v instanceof HTMLVideoElement && v.dataset.fallback && v.src !== v.dataset.fallback) v.src = v.dataset.fallback
}, true)

// ---------- featured (recorded evidence; /api/showcase overrides by id) ----------
type Feat = { id: string; title: string; tag: string; cls: string; video?: string; trust: Trust; kv: [string, string][]; extra?: string }
const RID = (s: string) => `<code>${short(s, 8, 4)}</code>`
const FEAT: Feat[] = [
  { id: 'swarm', title: '4-car swarm · Staggered Cut-in', tag: 'swarm-carla-010 · CARLA 0.10', cls: 'c', video: 'videos/swarm-carla-010__stitched.mp4',
    trust: { decisions0g: 10, decisions: 10, requestId: 'e1a9a298-520d-42bf-ad30-ad67d0cc5894', provider: '0xf4FB8d2bD856e672b5f9848b0eD235A20079B250', sigsVerified: 10, sigsTotal: 10, agentId: 579, note: '', free: false },
    kv: [['Plan (0G thinking call)', RID('e1a9a298-520d-42bf-ad30-ad67d0cc5894')], ['0G / halts', '10 / 0'], ['GT CCS', '0.90'], ['Min gap', '3.49 m'], ['Min TTC', '1.13 s'], ['Collision', 'none'], ['Anchored', 'no (prototype)']],
    extra: `<div class="feed"><div>A red Charger · ego lane · ~22 m ahead</div><div>B yellow taxi · left lane · ~4 m ahead</div><div>C blue Mini · left lane · beside ego</div><div>D magenta Patrol · ego lane · ~9 m behind</div><div>executor: one 0G call per 1 s → {"actions": {A..D}, "phase", "why"} · strict parse, any bad action → all SAFE_HALT</div></div>` },
  { id: 'arena', title: 'A/B arena · PDM-Lite vs cautious IDM', tag: 'arena-script-001 · 4 sites', cls: 'y', video: 'videos/arena-script-001__r4l2s24__side_by_side.mp4',
    trust: { note: 'replayed adversary script (cutin-002) · no 0G calls' }, kv: [],
    extra: '' },
  { id: 'research', title: 'Research mission · boundary hunt', tag: 'hunt-bench-002 · research-mission-001', cls: 'l', video: 'videos/research-mission-001__carla-failure.mp4',
    trust: { decisions0g: 9, decisions: 9, requestId: 'a00eb00f-1205-4518-ad7d-095c6e6a2ffb', provider: '0xf4FB8d2bD856e672b5f9848b0eD235A20079B250', sigsVerified: 47, sigsTotal: 47, agentId: 579 },
    kv: [['Minimized case #21', '18.75 m/s · gap 25 m · lead 3.66 m/s² · μ 0.8 · delay 0.6 s'], ['Result', 'collision · min gap −0.008 m'], ['0G fix min_gap 3.0', 'no-change · 0.36 m (unsafe)'], ['Grid fix', 'safe · 4.74 m · suite unsafe 19 → 0'], ['Audit', '5 supported · 2 contradicted']],
    extra: '<canvas id="hunt" style="width:100%;height:240px;display:block;margin-top:12px"></canvas><div class="feed" id="hunt-feed"></div>' },
  { id: 'memory', title: 'Version memory · v1.0 → v1.1', tag: 'idm-follower · 135 paired tests', cls: 'p',
    trust: { decisions0g: 2, decisions: 2, requestId: 'b2aed5f9-d6a8-4392-8ca2-1260ff907a7e', provider: '0xf4FB8d2bD856e672b5f9848b0eD235A20079B250', sigsVerified: 2, sigsTotal: 2,
      publicRoot: '0x0ff260127d38daecf4debacdd03dbf0df239b42ea5285502bc6e97f8d716ed4b', sealedRoot: '0x1c76089af9ac60fe06f10ea238ffd381a750d21086b569313cf8cc175e468e2a',
      agentId: 579, arkiv: '0x63990b662ebd9c39cda12bf0e550e9e03302462022b8e9bdfef7fea374f89dcd' },
    kv: [['Anchor v1.1 (seq 2)', link(galileoTx('0x9a7265d1e1aa58f554bff0b92b7c871db34cc59a1875ceb86b2fe0693077b084'), '0x9a7265d1…b084')], ['AgentMemoryRegistry', link(galileoAddr('0x7a8676D267f1aa17d6B55cF5BfcD2A9509b963e3'), '0x7a8676…63e3')], ['Fingerprints', '7 fixed · 3 persist · 0 new'], ['Regressions', '0'], ['Arkiv claims', '8 · Rabdi · faultline.claim/v1']],
    extra: `<div class="board" style="margin-top:12px">${([['low_friction', '5/11', '1/11', 'persists 1'], ['slow_reaction', '9/27', '2/27', 'persists 2'], ['hard_brake', '6/30', '0/30', 'fixed'], ['lead_brake', '9/67', '0/67', 'fixed']] as const)
      .map(([c, a, b, v]) => `<div class="cell"><small class="muted">${c}</small><b>${a} → ${b}</b><span class="pill sm ${v === 'fixed' ? 'l' : 'y'}">${v}</span></div>`).join('')}</div><p class="muted" style="font-size:12px;margin:8px 0 0">collisions v1.0 → v1.1 per category · Arkiv entities owned by 0x8dac…1069</p>` },
  { id: 'paid002', title: 'Paid CARLA job 002', tag: 'x402 → CARLA → 0G → Galileo', cls: 'c', video: 'videos/paid-dryrun-carla-002__chase.mp4',
    trust: { decisions0g: 7, decisions: 8, requestId: '95718d4a-8007-40eb-b859-b4019ad1c70f', provider: '0xf4FB8d2bD856e672b5f9848b0eD235A20079B250', sigsVerified: 7, sigsTotal: 7,
      publicRoot: '0xc1219e48d517edabbea12db2bddf21294bcd5ddb106b00d963d8837cb75f6748', sealedRoot: '0x47b995a796e09cb39372e901b12da52edb5c4299add069416baccc440d9a71fa',
      commitTx: '0x512ead9bd41cbf78313df571195226533d7bfaaeec02501b7c8e2f7f39643372', finalizeTx: '0x1ece91e630a9dcdcd326515b57934e02c0c1c5e84e339020fe0a6819e3f7f7ab', onchainMatches: true, commitBeforeFirst: true,
      registry: '0xeE2260cE4835059F0e0f1FB9C9948Ca5a7d4b5A4', agentId: 579, hedera: { transaction: '0.0.9185802@1794006563.434123686', hashscan: 'https://hashscan.io/testnet/transaction/0.0.9185802@1794006563.434123686' } },
    kv: [], extra: `<ul class="timeline" style="margin-top:12px">${([
      ['Quote → pay 0.001 ℏ', link('https://hashscan.io/testnet/transaction/0.0.9185802@1794006563.434123686', '0.0.9185802@1794006563…')],
      ['Permit · job de2d56fd…', 'suite cut-in-v1-carla · maxRuns 1'],
      ['Commit · block 64245811', link(galileoTx('0x512ead9bd41cbf78313df571195226533d7bfaaeec02501b7c8e2f7f39643372'), '0x512ead9b…3372')],
      ['First 0G call', '2026-11-06T23:10:19.269Z'],
      ['0G decisions', '7 from 0G · cp7 SAFE_HALT (bad_nonce)'],
      ['0G Storage', 'public 0xc1219e48…6748 · sealed 0x47b995a7…71fa'],
      ['Finalize · onchainMatches', link(galileoTx('0x1ece91e630a9dcdcd326515b57934e02c0c1c5e84e339020fe0a6819e3f7f7ab'), '0x1ece91e6…f7ab')],
      ['Permit reuse', '409 run_not_authorized'],
      ['Report', 'CCS 0.929 · min TTC 1.03 s · no collision'],
    ] as const).map(([t, d]) => `<li><i class="ic ok"></i><div><div class="t">${t}</div><div class="d">${d}</div></div></li>`).join('')}</ul>` },
]
const ARENA_RECORDED = { src: 'recorded · arena-script-001 · r4l2s24', rows: [
  { policy: 'pdm-lite', name: 'PDM-Lite (LiDAR)', drivingScore: 60.3, ccs: 0.909, minTtc: 1.11, minGap: 3.49, collision: false },
  { policy: 'idm-cautious', name: 'Cautious IDM (1.6 s)', drivingScore: 60.7, ccs: 0.055, minTtc: 3.12, minGap: 3.20, collision: false },
], video: 'videos/arena-script-001__r4l2s24__side_by_side.mp4' }
type ArenaRow = { policy: string; name?: string; drivingScore: number | null; ccs: number | null; minTtc: number | null; minGap?: number | null; collision: boolean | null }
function arenaTable(rows: ArenaRow[]) {
  const best = (k: 'drivingScore' | 'minTtc') => Math.max(...rows.map((r) => r[k] ?? -Infinity))
  return `<table><thead><tr><th>Policy</th><th>Driving score</th><th>CCS</th><th>Min TTC</th><th>Min gap</th><th>Collision</th></tr></thead><tbody>${rows.map((r) =>
    `<tr><td>${esc(r.name ?? r.policy)}</td><td class="mono">${num(r.drivingScore, 1)}${r.drivingScore === best('drivingScore') ? ' ▲' : ''}</td>
     <td><span class="pill sm ${risk(r.ccs).cls}">${num(r.ccs, 3)}</span></td><td class="mono">${num(r.minTtc)} s${r.minTtc === best('minTtc') ? ' ▲' : ''}</td>
     <td class="mono">${num(r.minGap)} m</td><td><span class="pill sm ${r.collision ? 'p' : r.collision === false ? 'l' : ''}">${r.collision ? 'yes' : r.collision === false ? 'no' : '—'}</span></td></tr>`).join('')}</tbody></table>`
}
FEAT[1].extra = `<div class="tscroll" style="margin-top:12px">${arenaTable(ARENA_RECORDED.rows)}</div><p class="muted" style="font-size:12px;margin:8px 0 0">same at all 4 sites · IDM keeps TTC ≈ 3.1 s, PDM-Lite drops to ≈ 1.1 s</p>`

let featLive = false
async function renderFeatured() {
  try {
    const sc = await getJson('/api/showcase'), items: any[] = Array.isArray(sc) ? sc : sc.items ?? []
    for (const it of items) { const f = FEAT.find((x) => x.id === it.id); if (!f) continue; if (it.video) f.video = it.video; if (it.trust) f.trust = { ...f.trust, ...it.trust }; featLive = true }
  } catch { /* recorded values stay */ }
  $('featured').innerHTML = FEAT.map((f, i) => `<div class="card ${f.cls} ${i === 0 || f.id === 'paid002' ? 'wide' : ''}" id="f-${f.id}">
    <div class="head"><h2>${esc(f.title)}</h2><span class="pill sm">${esc(f.tag)}</span></div>
    <div class="grid ${f.video && (i === 0 || f.id === 'paid002') ? 'split' : ''}">
      ${f.video ? `<div>${video(f.video)}</div>` : ''}
      <div>${f.kv.length ? `<dl class="kv">${kv(f.kv)}</dl>` : ''}${f.extra ?? ''}</div>
    </div>
    <div class="rail" style="padding:14px 0 0">${railHtml(f.trust)}</div>
    <div class="muted" style="font-size:11px;margin-top:8px">${featLive ? 'source: console /api/showcase' : 'source: recorded evidence · docs/evidence'}</div></div>`).join('')
  drawHunt()
}
let hunt: any = null
async function drawHunt() {
  const cv = document.getElementById('hunt') as HTMLCanvasElement | null; if (!cv) return
  if (!hunt) try { hunt = await fetch('hunt.json').then((r) => r.json()) } catch { return }
  const ex: any[] = hunt.experiments, truth: [number, number][] = hunt.truth
  let n = 0
  const paint = () => {
    const { g, w, h } = setup(cv), pad = 30, X = (d: number) => pad + ((d - 0.3) / 1.2) * (w - pad * 2), Y = (gap: number) => h - pad - (gap / 80) * (h - pad * 2)
    g.clearRect(0, 0, w, h); g.fillStyle = '#ffffffa0'; g.beginPath(); g.roundRect(0, 0, w, h, 16); g.fill()
    g.strokeStyle = C.ink; g.lineWidth = 2; g.setLineDash([6, 5]); g.beginPath(); truth.forEach(([d, gap], i) => (i ? g.lineTo(X(d), Y(gap)) : g.moveTo(X(d), Y(gap)))); g.stroke(); g.setLineDash([])
    for (const e of ex.slice(0, n)) { g.fillStyle = e.safe ? C.lime : C.pink; g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.arc(X(e.delay), Y(e.gap), 6, 0, Math.PI * 2); g.fill(); g.stroke() }
    g.fillStyle = C.ink; g.font = '500 11px "Space Grotesk", sans-serif'
    g.fillText('reaction delay 0.3 → 1.5 s', pad, h - 8); g.fillText('gap 0–80 m', 4, 14); g.fillText(`--- ground truth · ● 0G experiment ${n}/${ex.length}`, w / 2 - 40, 14)
  }
  const feed = $('hunt-feed')
  const step = () => {
    if (!document.body.contains(cv)) return
    n++; paint()
    const e = ex[n - 1]; if (e) feed.insertAdjacentHTML('afterbegin', `<div>#${e.n} · ${num(e.delay, 2)} s · ${num(e.gap, 1)} m · ${e.safe ? 'safe' : 'unsafe'} · ${short(e.rid, 8, 4)}<br>${esc(e.why)}</div>`)
    if (n < ex.length) setTimeout(step, 350)
  }
  step()
}

// ---------- free demo run, arena ----------
async function pollJob(id: string, onUpdate: (j: any) => void) {
  for (;;) {
    const j = await getJson(`/api/jobs/${encodeURIComponent(id)}`); onUpdate(j)
    if (['done', 'failed', 'error', 'completed'].includes(j.status)) return j
    await sleep(1500)
  }
}
async function demoRun(suiteId: string, out: HTMLElement) {
  out.textContent = 'queuing…'
  try {
    const r = await postJson('/api/demo-run', { policy, suite: suiteId, mode: 'free' })
    out.textContent = `job ${short(r.jobId, 6, 4)} · queue #${r.queuePos ?? '—'}`
    closeGuide(); startStream(r.jobId, 'live', 'job', true)
  } catch (e) { out.textContent = `${(e as Error).message}${online ? '' : ' · console offline'}` }
}
async function runArena() {
  const a = $<HTMLSelectElement>('ab-a').value, b = $<HTMLSelectElement>('ab-b').value
  $('ab-err').textContent = ''
  if (a === b) { $('ab-err').textContent = 'Pick two different policies'; return }
  const btn = $<HTMLButtonElement>('ab-run'); btn.disabled = true
  try {
    const r = await postJson('/api/arena', { policies: [a, b], mode: 'script' })
    $('ab-status').textContent = `job ${short(r.jobId, 6, 4)} · queue #${r.queuePos ?? '—'}`
    const j = await pollJob(r.jobId, (j) => { $('ab-status').textContent = `${esc(j.status)}${j.queuePos != null ? ` · queue #${j.queuePos}` : ''}${j.etaS != null ? ` · ETA ${Math.round(j.etaS)} s` : ''}` })
    const rows: ArenaRow[] = j.results ?? j.rows ?? []
    if (!rows.length) throw new Error(j.error ?? 'arena returned no results')
    renderArena(rows, `live · job ${short(r.jobId, 6, 4)} · scripted adversary`, j.video)
  } catch (e) { $('ab-err').textContent = `${(e as Error).message}${online ? '' : ' · console offline: showing the recorded arena'}` } finally { btn.disabled = false }
}
function renderArena(rows: ArenaRow[], src: string, vid?: string) {
  $('ab-table').innerHTML = arenaTable(rows); $('ab-src').textContent = src
  $('ab-video').innerHTML = vid ? video(vid) : '<span class="muted">no video for this run</span>'
}
$('ab-run').addEventListener('click', runArena)

// ---------- judge guide ----------
const GKEY = 'faultline.guide.seen'
let gstep = 0
const G_STEPS = ['Pick an AV policy', 'Watch a recorded attack', 'Launch a live test', 'Verify the evidence']
function openGuide(i = 0) { gstep = i; $('guide').classList.remove('hidden'); renderGuide() }
function closeGuide() { $('guide').classList.add('hidden'); try { localStorage.setItem(GKEY, '1') } catch { /* private mode */ } }
function renderGuide() {
  $('g-steps').innerHTML = G_STEPS.map((t, i) => `<button class="pill sm ${i === gstep ? 'on' : ''}" data-g="${i}">${i + 1} · ${t}</button>`).join('')
  $('g-steps').querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) => b.addEventListener('click', () => { gstep = Number(b.dataset.g); renderGuide() }))
  const nav = `<div class="row-btns" style="margin-top:20px">${gstep > 0 ? '<button class="btn" id="g-prev">← Back</button>' : ''}${gstep < 3 ? '<button class="btn k" id="g-next">Next →</button>' : '<button class="btn k" id="g-done">Done</button>'}</div>`
  let body = ''
  if (gstep === 0) body = `<h3>Pick an AV policy</h3>${policies.map((p) => `<button class="opt ${p.id === policy ? 'on' : ''}" data-pol="${esc(p.id)}">
      <b>${esc(p.name)}</b> <span class="pill sm ${p.compatible ? 'l' : p.compatible === false ? 'p' : ''}">${p.compatible ? 'COMPATIBLE' : p.compatible === false ? 'INCOMPATIBLE' : 'unchecked'}</span>
      <div class="muted" style="font-size:13px;margin:6px 0">${esc(p.description)}</div><div class="mono">digest ${esc(p.digest)}</div><div class="mono muted">${esc(p.check ?? '')}</div></button>`).join('')}
      <span class="pill sm">${policiesLive ? 'source: console /api/policies' : 'source: recorded checker output'}</span> <a class="pill sm c" href="${BYO}" target="_blank" rel="noopener">Bring your own stack ↗</a>`
  if (gstep === 1) body = `<h3>Watch a recorded attack</h3><div class="row-btns" style="margin-top:0">
      <button class="btn y" id="g-swarm">4-car swarm video</button><button class="btn" id="g-replay" ${online ? '' : 'disabled'}>Replay a cut-in · decision by decision</button></div>
      <p class="muted" style="font-size:13px">free · each 0G decision shows its request id and the model's JSON</p>`
  if (gstep === 2) body = `<h3>Launch a live test</h3><div class="row-btns" style="margin-top:0">
      <button class="btn k" data-demo="cut-in-v1-kinematic" ${online ? '' : 'disabled'}>Free run · kinematic</button><button class="btn" data-demo="cut-in-v1-carla" ${online ? '' : 'disabled'}>Free run · CARLA</button>
      <button class="btn y" id="g-paid">Paid run · x402 on Hedera</button></div><p class="mono" id="g-demo-out" style="font-size:12px">${online ? `policy ${esc(policy)} · free = real 0G decisions, no payment, not anchored` : 'console offline'}</p>`
  if (gstep === 3) body = `<h3>Verify the evidence</h3><div class="rail" style="padding:0">${railHtml(FEAT.find((f) => f.id === 'paid002')!.trust)}</div>
      <div class="row-btns"><button class="btn y" id="g-verify">Open paid job 002 timeline</button></div>`
  $('g-body').innerHTML = body + nav
  const on = (id: string, f: () => void) => document.getElementById(id)?.addEventListener('click', f)
  on('g-prev', () => { gstep--; renderGuide() }); on('g-next', () => { gstep++; renderGuide() }); on('g-done', closeGuide)
  $('g-body').querySelectorAll<HTMLButtonElement>('[data-pol]').forEach((b) => b.addEventListener('click', () => { policy = b.dataset.pol!; renderGuide() }))
  $('g-body').querySelectorAll<HTMLButtonElement>('[data-demo]').forEach((b) => b.addEventListener('click', () => demoRun(b.dataset.demo!, $('g-demo-out'))))
  on('g-swarm', () => { closeGuide(); show('featured'); document.getElementById('f-swarm')?.scrollIntoView() })
  on('g-replay', () => { const r = allRuns[0]; if (r) { closeGuide(); startStream(r.name, 'replay') } })
  on('g-paid', () => { closeGuide(); show('order') })
  on('g-verify', () => { closeGuide(); show('featured'); document.getElementById('f-paid002')?.scrollIntoView() })
}
$('guide-btn').addEventListener('click', () => openGuide(0))
$('g-skip').addEventListener('click', closeGuide)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('guide').classList.contains('hidden')) closeGuide() })

async function boot() {
  renderArena(ARENA_RECORDED.rows, ARENA_RECORDED.src, ARENA_RECORDED.video)
  show('featured')
  await Promise.all([health(), loadPolicies(), renderFeatured()])
  setInterval(health, 10000)
  let seen = false; try { seen = localStorage.getItem(GKEY) === '1' } catch { /* private mode */ }
  if (!seen) openGuide(0)
}
boot()
