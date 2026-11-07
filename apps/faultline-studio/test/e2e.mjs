// Playwright journeys for the PRD Studio (contract docs/superpowers/specs/2026-11-07-studio-prd-build-contract.md, "Journeys").
// Serves a built Studio, mocks every /api/* call (never the real console), injects an EIP-6963 wallet with a throwaway viem key.
// STUDIO_OUT=<dir> node apps/faultline-studio/build.mjs && node apps/faultline-studio/test/e2e.mjs [<dir>] [--shots <dir>]
// env: PLAYWRIGHT_MODULE (path to playwright-core), CHROMIUM_PATH (Chromium executable). Exit code = number of failed checks.
// Fixtures: fixture-run.ndjson (paid test 002), fixtures/safe-halt.ndjson (runs/halt-001), fixtures/swarm-010.ndjson
// (runs/swarm-carla-010), fixtures/verify-002.json; regenerate the two replays with fixtures/make.mjs.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined }
const pos = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--shots')
const dist = resolve(pos ?? process.env.STUDIO_OUT ?? new URL('../dist/', import.meta.url).pathname) + '/'
const shots = arg('--shots')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' }
const server = createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]), app = /^\/(verifier|memory)\//.exec(u)?.[0] ?? '/'
  const p = join(dist, extname(u) ? u : app + 'index.html') // static apps keep their own index; everything else falls back to the SPA like Vercel
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p))
}).listen(0)
const base = `http://127.0.0.1:${server.address().port}`

// ---------- fixtures: recorded paid test 002 (status interrupted), a free run derived from it, /api/verify for its root ----------
const fixture = readFileSync(new URL('./fixture-run.ndjson', import.meta.url), 'utf8')
const meta = JSON.parse(fixture.split('\n')[0]).run
const FEATURED = meta.name, ROOT = meta.storage.publicRoot, SWARM = 'swarm-carla-010'
const verify002 = readFileSync(new URL('./fixtures/verify-002.json', import.meta.url), 'utf8')
const FREE = 'demo-free-carla-1794000000000/town10__pdm-lite'
const freeRun = { ...meta, name: FREE, jobId: null, free: true, chain: null, storage: null, payment: null, status: 'completed' }
const JOB = '0123456789abcdef'
const replayOf = (f) => { const nd = readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'); return { nd, run: JSON.parse(nd.split('\n')[0]).run } }
const HALT = replayOf('safe-halt.ndjson'), SWARMR = replayOf('swarm-010.ndjson')
const RUNS = { [FEATURED]: meta, [FREE]: freeRun, [HALT.run.name]: HALT.run, [SWARM]: SWARMR.run }
// withMeta swaps the meta line; live job streams (mock below) also drop the done line, so the job is still running
const withMeta = (run) => fixture.replace(/^.*\n/, JSON.stringify({ t: 'meta', run, totalTicks: 194, totalDecisions: 8, mode: 'replay' }) + '\n')
const PAID_POLICIES = [
  { id: 'pdm-lite', name: 'PDM-Lite (LiDAR)', description: 'fixture', digest: '0x537db480f1840d95832fa2b2bd855075ad45b5f4cafb7b64f9eed6c2dd266bba', compatible: true, paid: true },
  { id: 'idm-cautious', name: 'Cautious IDM', description: 'fixture', digest: '0x7a2b', compatible: true, paid: false }]

let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++ }
const journey = async (name, fn) => { try { await fn() } catch (e) { check(false, `${name}: ${e.message.split('\n')[0]}`) } }

/** Route every request: same-origin static passes, /api/* answers from opts, everything else aborts (no real console, no CDN but fonts). */
async function mock(page, o = {}) {
  const s = { online: true, carla: true, hedera: true, posts: [], launches: [], verify: { status: 200, body: verify002 }, signFail: 0, catalog: { cap: '500000000', merchant: '0.0.9185802', pending: [] }, ...o }
  await page.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url())
    if (u.origin !== base) return u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com') ? route.continue() : route.abort()
    if (!u.pathname.startsWith('/api/') && !u.pathname.startsWith('/media/')) return route.continue()
    if (!s.online || u.pathname.startsWith('/media/')) return route.fulfill({ status: 503, body: '' })
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) })
    const p = u.pathname
    if (p === '/api/health') return json({ ok: true, carla: s.carla, zg: true, hedera: s.hedera, queue: { running: 0, waiting: 0 }, caps: { runs_left: 5, buys_left: 3 } })
    if (p === '/api/policies') return json(PAID_POLICIES)
    if (p === '/api/catalog') return json(s.catalog)
    if (p === '/api/runs') return json(Object.values(RUNS))
    if (p === '/api/run') { const r = RUNS[u.searchParams.get('name')]; return r ? json(r) : json({ error: 'unknown run' }, 404) }
    if (p.startsWith('/api/jobs/')) return json({ id: p.slice(10), kind: 'demo', policy: 'pdm-lite', suite: 'cut-in-v1-carla', mode: 'free', label: 'fixture', status: 'running', error: null, result: null })
    if (p === '/api/showcase') return json({ items: [] })
    if (p === '/api/verify') return u.searchParams.get('root') === ROOT ? json(s.verify.body, s.verify.status) : json({ error: 'unknown root' }, 422)
    if (p === '/api/demo-run') { const b = JSON.parse(req.postData() ?? '{}'); s.posts.push(b); await new Promise((r) => setTimeout(r, 150)); return json({ jobId: JOB, queuePos: 0, label: 'fixture' }) }
    if (p === '/api/launch') { s.launches.push(JSON.parse(req.postData() ?? '{}')); return json({ run: FEATURED }) }
    if (p === '/api/stream') {
      const b = JSON.parse(req.postData() ?? '{}')
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: b.job ? withMeta({ ...meta, name: `demo-free-carla-${b.job}`, jobId: b.job, free: true }).replace(/\n.*"t":"done".*\n?/, '\n') : b.run === FREE ? withMeta(freeRun) : b.run === HALT.run.name ? HALT.nd : b.run === SWARM ? SWARMR.nd : b.run === FEATURED ? fixture : '{"t":"error","message":"unknown run"}\n' })
    }
    return json({ error: 'not mocked' }, 404)
  })
  return s
}

const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts')
const { verifyMessage } = await import('viem')
const acct = privateKeyToAccount(generatePrivateKey())
/** EIP-6963 wallet; the first `reject` personal_sign calls throw a 4001 user rejection. */
async function wallet(page, reject = 0) {
  await page.exposeFunction('__fixtureSign', (hex) => acct.signMessage({ message: { raw: hex } }))
  await page.addInitScript(({ address, reject }) => {
    let left = reject
    const provider = { request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address]
      if (method === 'personal_sign') { if (left-- > 0) throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); return window.__fixtureSign(params[0]) }
      throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 }) } }
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider',
      { detail: { info: { uuid: 'fixture', name: 'Fixture Wallet', icon: '', rdns: 'test.fixture' }, provider } })))
  }, { address: acct.address, reject })
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
async function fresh(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: shots ? 2 : 1 })
  const page = await ctx.newPage(), errors = []
  page.on('pageerror', (e) => errors.push(`${new URL(page.url()).pathname}: ${e.message}`))
  return { ctx, page, errors }
}
const text = (page, sel) => page.locator(sel).first().innerText()
const path = (page) => new URL(page.url()).pathname
const visibleSection = (page) => page.evaluate(() => [...document.querySelectorAll('main > section')].filter((s) => !s.classList.contains('hidden')).map((s) => s.id).join(','))
const shot = async (page, name, full = false) => { if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: `${shots}/e2e-${name}.png`, fullPage: full }) } }
const navOn = (page) => page.evaluate(() => document.querySelector('#nav a[aria-current="page"]')?.dataset.nav ?? null)
/** Walk the Lab to step 4 with the given choices (clicks the visible step's own buttons). */
async function labTo4(page, { pol, atk, mode } = {}) {
  await page.waitForSelector('#lab-policies [role=radio]')
  if (pol) await page.click(`#lab-policies [data-pol="${pol}"]`)
  await page.click('#lab-s1 [data-next="2"]')
  if (atk) await page.click(`#lab-attacks [data-atk="${atk}"]`)
  await page.click('#lab-s2 [data-next="3"]')
  if (mode) { await page.waitForSelector(`#lab-modes [data-mode="${mode}"]:not([disabled])`); await page.click(`#lab-modes [data-mode="${mode}"]`) }
  await page.click('#lab-s3 [data-next="4"]')
  await page.waitForSelector('#lab-s4:not(.hidden)')
}

try {
  // ---------- 1. Judge, console offline: / → recorded run → results → verify → judge tour 6 steps ----------
  await journey('judge offline', async () => {
    const { page, errors } = await fresh(); await mock(page, { online: false })
    await page.goto(base)
    await page.waitForFunction(() => /Recorded content available/.test(document.getElementById('status-txt')?.textContent ?? ''), null, { timeout: 10000 })
    check(await page.locator('#offline-strip').isVisible(), 'offline: strip shown, header says "Recorded content available"')
    check(await navOn(page) === 'home' && await visibleSection(page) === 'v-home', 'offline: / shows Discover, nav lit')
    for (const [p, sec, nav] of [[`/mission/${FEATURED}`, 'v-mission', 'library'], [`/results/${FEATURED}`, 'v-results', 'library'], [`/verify/${FEATURED}`, 'v-verify', 'verify'], ['/library', 'v-library', 'library'], ['/stack', 'v-stack', 'lab']]) {
      await page.goto(base + p); await page.waitForTimeout(500)
      check(await visibleSection(page) === sec && await navOn(page) === nav, `offline: ${p} shows ${sec}, nav ${nav} lit`)
    }
    await page.goto(base)
    const opener = page.locator('[data-judge]:visible').first()
    await opener.click()
    await page.waitForFunction(() => /1 of 6/.test(document.getElementById('j-step')?.textContent ?? ''))
    check(await page.locator('#judge').isVisible() && (await text(page, '#j-title')).length > 0, 'judge 1: dialog open with a title')
    check(await page.evaluate(() => document.activeElement?.id === 'j-title'), 'judge: focus moves into the dialog')
    const want = ['/', `/mission/${SWARM}`, `/mission/${FEATURED}`, `/verify/${FEATURED}`, `/verify/${FEATURED}`, '/research']
    for (let i = 1; i < 6; i++) {
      await page.click('#j-next')
      await page.waitForFunction((n) => new RegExp(`${n} of 6`).test(document.getElementById('j-step').textContent), i + 1)
      await page.waitForURL((u) => u.pathname === want[i], { timeout: 10000 }).catch(() => {})
      check(path(page) === want[i] && await visibleSection(page) !== '', `judge ${i + 1}: on ${want[i]} (${await text(page, '#j-title')})`)
    }
    await page.click('#j-prev')
    await page.waitForFunction(() => /5 of 6/.test(document.getElementById('j-step').textContent))
    check(true, 'judge: Back returns to step 5')
    await page.keyboard.press('Escape')
    check(await page.locator('#judge').isHidden(), 'judge: Escape closes the dialog')
    check(await page.locator('.hl').count() === 0, 'judge: highlights cleared on close')
    await page.goto(base); await opener.click(); await page.waitForFunction(() => /1 of 6/.test(document.getElementById('j-step').textContent))
    await page.click('#j-close')
    check(await page.locator('#judge').isHidden() && await page.evaluate(() => !!document.activeElement?.closest('[data-judge]')), 'judge: Close returns focus to the opener')
    await shot(page, 'judge-offline')
    check(errors.length === 0, `judge offline: no page errors ${errors.join(' | ')}`)
  })

  // ---------- 2. Guest free run ----------
  await journey('guest', async () => {
    const { page, errors } = await fresh(); await mock(page, { carla: false })
    await page.goto(`${base}/lab`)
    await page.waitForFunction(() => /CARLA offline/.test(document.getElementById('status-txt')?.textContent ?? ''), null, { timeout: 10000 })
    check(await navOn(page) === 'lab', 'lab: nav "Run a test" lit')
    await page.click('#lab-s1 [data-next="2"]'); await page.click('#lab-s2 [data-next="3"]')
    const free = page.locator('#lab-modes [data-mode="free"]')
    check(await free.isDisabled() && /CARLA is offline/.test(await free.innerText()), 'guest: CARLA offline disables the free live run with its reason')
    check(await page.locator('#lab-modes [data-mode="replay"]').isEnabled(), 'guest: Replay stays available')

    const { page: g, errors: e2 } = await fresh(); const s = await mock(g)
    await g.goto(`${base}/lab`); await g.waitForFunction(() => /CARLA online/.test(document.getElementById('status-txt')?.textContent ?? ''), null, { timeout: 10000 })
    await labTo4(g, { mode: 'free' })
    await g.click('#lab-guest')
    check(/Start free guest run/.test(await text(g, '#lab-start')) && await g.locator('#lab-start').isEnabled(), 'guest: continue without a wallet enables the start button')
    await g.dblclick('#lab-start')
    await g.waitForURL((u) => u.pathname === `/mission/${JOB}`, { timeout: 10000 })
    await g.waitForTimeout(400)
    check(s.posts.length === 1, `guest: double click posts exactly one job (got ${s.posts.length})`)
    check(s.posts[0]?.guest === true && s.posts[0]?.mode === 'free' && !s.posts[0]?.signature && s.posts[0]?.suite === 'cut-in-v1-carla', 'guest: unsigned free cut-in request with guest flag')
    await g.reload(); await g.waitForTimeout(600)
    check(path(g) === `/mission/${JOB}` && await visibleSection(g) === 'v-mission', `guest: reload returns to the same job (${path(g)} ${await visibleSection(g)})`)
    await shot(g, 'guest-mission')
    check(errors.length === 0 && e2.length === 0, `guest: no page errors ${[...errors, ...e2].join(' | ')}`)
  })

  // ---------- 3. Wallet: exact message, 4001 keeps choices, signing posts one signed request ----------
  await journey('wallet', async () => {
    const { page, errors } = await fresh(); await wallet(page, 1); const s = await mock(page)
    await page.goto(`${base}/lab`)
    await labTo4(page, { mode: 'free' })
    await page.click('#lab-wallets [data-w="0"]')
    await page.waitForFunction(() => /0x/.test(document.getElementById('wallet-btn').textContent))
    check((await text(page, '#wallet-btn')).includes(acct.address.slice(0, 6)), 'wallet: header shows the connected address')
    await page.click('#lab-msg-box summary')
    check(/^Faultline test request\npolicy: pdm-lite\nsuite: cut-in-v1-carla\nmode: free\nnonce: .+\nissued: .+$/.test(await text(page, '#lab-msg')), 'wallet: the exact EIP-191 message is shown before signing')
    await page.click('#lab-start')
    await page.waitForFunction(() => (document.getElementById('lab-start-why')?.textContent ?? '').length > 0 && !document.getElementById('lab-start').disabled)
    check(path(page) === '/lab' && s.posts.length === 0 && await page.locator('#lab-modes [data-mode="free"][aria-checked="true"]').count() === 1, 'wallet: rejection (4001) keeps the choices and posts nothing')
    await page.click('#lab-start')
    await page.waitForURL((u) => u.pathname === `/mission/${JOB}`, { timeout: 10000 })
    const b = s.posts[0]
    check(s.posts.length === 1 && !!b?.signature && await verifyMessage({ address: b.address, message: b.message, signature: b.signature }), 'wallet: one request posted, its signature verifies for the wallet')
    check(errors.length === 0, `wallet: no page errors ${errors.join(' | ')}`)
  })

  // ---------- 4. Paid path: review card facts; a pending paid job shows Launch, never a second pay ----------
  await journey('paid', async () => {
    const { page, errors } = await fresh(); await wallet(page); const s = await mock(page)
    await page.goto(`${base}/lab`)
    await labTo4(page, { mode: 'free' })
    await page.click('#lab-wallets [data-w="0"]')
    await page.click('#lab-live [data-next="3"]'); await page.waitForSelector('#lab-modes [data-mode="paid"]:not([disabled])')
    await page.click('#lab-modes [data-mode="paid"]'); await page.click('#lab-s3 [data-next="4"]')
    await page.waitForFunction(() => /Merchant/.test(document.getElementById('lab-summary')?.textContent ?? ''))
    const sum = await text(page, '#lab-summary')
    check(/0\.0\.9185802/.test(sum) && /cut-in-v1-carla/.test(sum) && /5 HBAR per day/.test(sum) && /0\.001 HBAR/.test(sum) && /Faultline agent/.test(sum), 'paid: review shows merchant, suite, cap, 0.001 HBAR and payer')
    check(/A signature is never a payment/.test(await text(page, '#lab-s4')), 'paid: a signature is never called a payment')
    await shot(page, 'paid-review')

    const { page: q, errors: e2 } = await fresh(); await wallet(q)
    const s2 = await mock(q, { catalog: { cap: '500000000', merchant: '0.0.9185802', pending: [{ jobId: 'abcdef0123456789', suite: 'cut-in-v1-carla', hashscan: 'https://hashscan.io/testnet/transaction/x' }] } })
    await q.goto(`${base}/lab`); await labTo4(q, { mode: 'free' })
    await q.click('#lab-wallets [data-w="0"]')
    await q.click('#lab-live [data-next="3"]'); await q.waitForSelector('#lab-modes [data-mode="paid"]:not([disabled])')
    await q.click('#lab-modes [data-mode="paid"]'); await q.click('#lab-s3 [data-next="4"]')
    await q.waitForSelector('#lab-pending [data-launch]')
    check(await q.locator('#lab-start').isDisabled(), 'paid: with a pending paid job the new paid start is disabled')
    await q.click('#lab-pending [data-launch]')
    await q.waitForURL((u) => u.pathname === `/mission/${FEATURED}`, { timeout: 10000 })
    check(s2.launches.length === 1 && s2.launches[0].jobId === 'abcdef0123456789' && s2.posts.length === 0, 'paid: Launch posts /api/launch, never a second pay')
    check(s.posts.length === 0 && errors.length === 0 && e2.length === 0, `paid: no page errors ${[...errors, ...e2].join(' | ')}`)
  })

  // ---------- 5. Swarm ----------
  await journey('swarm', async () => {
    const { page, errors } = await fresh(); const s = await mock(page)
    await page.goto(`${base}/lab?attack=swarm`)
    await page.waitForFunction(() => /CARLA online/.test(document.getElementById('status-txt')?.textContent ?? ''), null, { timeout: 10000 })
    check(path(page) === '/lab', 'swarm: ?attack=swarm is consumed, address bar is /lab')
    await labTo4(page, { mode: 'free' })
    await page.click('#lab-guest'); await page.click('#lab-start')
    await page.waitForURL((u) => u.pathname.startsWith('/mission/'), { timeout: 10000 })
    check(s.posts[0]?.suite === 'swarm-v1-carla' && s.posts[0]?.mode === 'free', 'swarm: posts suite "swarm-v1-carla", free')
    await page.goto(`${base}/lab`)
    await page.click('#lab-stepper [data-s="1"]')
    await page.click('#lab-policies [data-pol="idm-cautious"]'); await page.click('#lab-s1 [data-next="2"]')
    const sw = page.locator('#lab-attacks [data-atk="swarm-v1-carla"]')
    check(await sw.isDisabled() && /PDM-Lite only/.test(await sw.innerText()), 'swarm: with Cautious IDM the swarm attack is disabled with its reason')
    await page.goto(`${base}/mission/${SWARM}`)
    const plan = await page.waitForFunction(() => /Staggered Cut-in/.test(document.getElementById('v-mission')?.innerText ?? ''), null, { timeout: 25000 }).then(() => true, () => false)
    check(plan, 'swarm: recorded swarm replay shows the 0G strategist plan ("Staggered Cut-in")')
    await shot(page, 'swarm-mission')
    check(errors.length === 0, `swarm: no page errors ${errors.join(' | ')}`)
  })

  // ---------- 6. SAFE_HALT run (runs/halt-001: one checkpoint, 0G unreachable, status interrupted) ----------
  await journey('safe halt', async () => {
    const { page, errors } = await fresh(); await mock(page)
    const H = HALT.run.name
    for (const [p, sec] of [[`/mission/${H}`, '#v-mission'], [`/results/${H}`, '#v-results']]) {
      await page.goto(base + p)
      const ok = await page.waitForFunction((s) => /Interrupted/.test(document.querySelector(s)?.innerText ?? ''), sec, { timeout: 25000 }).then(() => true, () => false)
      const t = await text(page, sec)
      check(ok, `safe halt: ${p} says Interrupted`)
      check(/no valid answer|unreachable/i.test(t), `safe halt: ${p} gives the reason (no valid answer from 0G)`)
      await shot(page, `safe-halt-${sec.slice(3)}`)
    }
    check(errors.length === 0, `safe halt: no page errors ${errors.join(' | ')}`)
  })

  // ---------- 7. Verify ----------
  await journey('verify', async () => {
    const { page, errors } = await fresh(); const s = await mock(page)
    await page.goto(`${base}/verify/${FEATURED}`)
    await page.waitForFunction(() => /Verified/.test(document.getElementById('v-verify')?.innerText ?? ''), null, { timeout: 20000 })
    const v = await text(page, '#v-verify')
    check(/Checked by local runner|Checked in this browser/.test(v), 'verify: Verified rows name their method')
    check(await page.locator(`#v-verify a[href="/verifier/index.html?root=${encodeURIComponent(ROOT)}"]`).count() > 0, 'verify: "Verify independently" links /verifier/index.html?root=<publicRoot>')
    await shot(page, 'verify', true)
    s.verify = { status: 422, body: { error: 'root not found on the indexer', rootMismatch: false } }
    await page.goto(`${base}/verify/${FEATURED}`)
    await page.waitForFunction(() => /Unavailable/.test(document.getElementById('v-verify')?.innerText ?? ''), null, { timeout: 20000 }).catch(() => {})
    const u = await text(page, '#v-verify')
    check(/Unavailable/.test(u) && !/\bFailed\b/.test(u), 'verify: 422 rootMismatch:false shows Unavailable, not Failed')
    await page.goto(`${base}/verify/${FREE}`)
    const na = await page.waitForFunction(() => /Not applicable/.test(document.getElementById('v-verify')?.innerText ?? ''), null, { timeout: 20000 }).then(() => true, () => false)
    check(na, 'verify: free run shows Not applicable')
    check(errors.length === 0, `verify: no page errors ${errors.join(' | ')}`)
  })

  // ---------- 8. Links, copy, widths, keyboard, phone menu ----------
  await journey('audit', async () => {
    const { page, errors } = await fresh(); await mock(page)
    const PAGES = ['/', '/lab', `/mission/${FEATURED}`, `/results/${FEATURED}`, '/verify', `/verify/${FEATURED}`, '/library', '/research', '/stack']
    const KNOWN = /^\/(lab|mission\/.+|results\/.+|verify(\/.+)?|library|research|stack)?$/
    const STATIC = /^\/(verifier|memory|media|lite|clips)\//
    let bad = [], scripted = []
    for (const p of PAGES) {
      await page.goto(base + p); await page.waitForTimeout(700)
      const hrefs = await page.$$eval('a[href^="/"]', (as) => as.map((a) => a.getAttribute('href')))
      for (const h of hrefs) { const pn = new URL(h, base).pathname; if (!KNOWN.test(pn) && !STATIC.test(pn)) bad.push(`${p} → ${h}`) }
      if (/scripted/i.test(await page.locator('body').innerText())) scripted.push(p)
    }
    check(bad.length === 0, `links: every a[href^="/"] is a known page or static app ${bad.slice(0, 5).join(' | ')}`)
    check(scripted.length === 0, `copy: no "scripted" on any page ${scripted.join(' ')}`)
    const wide = []
    for (const w of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width: w, height: 900 })
      for (const p of PAGES) { await page.goto(base + p); await page.waitForTimeout(400); const sw = await page.evaluate(() => document.documentElement.scrollWidth); if (sw > w) wide.push(`${p}@${w}=${sw}`) }
    }
    check(wide.length === 0, `widths 320/375/768/1024/1440: no horizontal scroll ${wide.slice(0, 6).join(' ')}`)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${base}/lab`); await page.waitForSelector('#lab-policies [role=radio]')
    await page.focus('#lab-policies [aria-checked="true"]'); await page.keyboard.press('ArrowRight')
    check(await page.evaluate(() => document.activeElement?.getAttribute('aria-checked') === 'true' && document.activeElement?.dataset.pol === 'idm-cautious'), 'keyboard: arrow keys move the Lab radio selection')
    await page.goto(`${base}/results/${FEATURED}`); await page.waitForSelector('#v-results [role=tab][aria-selected="true"]')
    await page.focus('#v-results [role=tab][aria-selected="true"]'); await page.keyboard.press('ArrowRight')
    check(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement?.getAttribute('aria-selected') === 'true' && document.activeElement?.id !== 'rs-t-replay'), 'keyboard: arrow keys move the Results tabs')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(base); await page.waitForTimeout(400)
    check(await page.locator('#menu-btn').isVisible(), 'phone: labelled menu button shown')
    await page.click('#menu-btn')
    check(await page.getAttribute('#menu-btn', 'aria-expanded') === 'true' && await page.locator('#nav a[data-nav="research"]').isVisible(), 'phone: menu opens the nav')
    await page.keyboard.press('Escape')
    check(await page.getAttribute('#menu-btn', 'aria-expanded') === 'false' && await page.evaluate(() => document.activeElement?.id === 'menu-btn'), 'phone: Escape closes the menu and returns focus')
    await page.click('#menu-btn'); await page.click('#nav a[data-nav="research"]')
    await page.waitForURL((u) => u.pathname === '/research')
    check(await navOn(page) === 'research' && await page.getAttribute('#menu-btn', 'aria-expanded') === 'false', 'phone: nav link navigates, lights Research, closes the menu')
    await shot(page, 'phone', true)
    const { page: sp } = await fresh(); await mock(sp) // own page: the static apps' own errors are not the Studio's
    for (const [u, sel, what] of [[`/verifier/index.html?root=${ROOT}`, 'verifier', 'independent verifier'], ['/memory/index.html', 'memory', 'Safety Memory']]) {
      const r = await sp.goto(base + u); await sp.waitForTimeout(300)
      check(r?.ok() && path(sp).startsWith(`/${sel}/`) && await sp.locator('#v-home').count() === 0, `static app: ${u} serves the ${what}, not the SPA`)
    }
    for (const [from, to] of [['/run/x', '/mission/x'], ['/proof', '/verify'], ['/runs', '/library'], ['/nope', '/']]) { await page.goto(base + from); await page.waitForTimeout(300); check(path(page) === to, `alias: ${from} → ${to}`) }
    check(errors.length === 0, `audit: no page errors ${errors.slice(0, 5).join(' | ')}`)
  })
} finally { await browser.close(); server.close() }
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(Math.min(failed, 255))
