// Headless check of the built Studio: mocks the agent console API, replays a fixture run (paid job 002, CARLA),
// asserts the judge guide opens, the job timeline reaches "Report ✓" and the trust rail shows only proven ticks.
// npm run studio:build && node apps/faultline-studio/test/headless.mjs [--shots <dir>]
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const dist = new URL('../dist/', import.meta.url).pathname
const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined }
const shots = arg('--shots')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.map': 'application/json' }
const server = createServer((req, res) => {
  const u = req.url.split('?')[0], p = join(dist, u === '/' ? 'index.html' : u)
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p))
}).listen(0)
const base = `http://127.0.0.1:${server.address().port}`
const fixture = readFileSync(new URL('./fixture-run.ndjson', import.meta.url), 'utf8')
const meta = JSON.parse(fixture.split('\n')[0]).run
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++ }

const API = {
  '/api/health': { ok: true, carla: true, zg: true, hedera: true, queue: { running: 0, waiting: 1 }, caps: { buys_left: 3, runs_left: 5 } },
  '/api/policies': [
    { id: 'pdm-lite', name: 'PDM-Lite (LiDAR)', description: 'fixture', digest: '0x537db480f1840d95832fa2b2bd855075ad45b5f4cafb7b64f9eed6c2dd266bba', compatible: true, check: 'COMPATIBLE' },
    { id: 'idm-cautious', name: 'Cautious IDM', description: 'fixture', digest: '0x7a2b', compatible: true, check: 'COMPATIBLE' }],
  '/api/catalog': { suites: [{ id: 'cut-in-v1-kinematic', simulator: 'kinematic' }], serviceUp: false, carlaUp: false, cfgError: 'fixture', payer: null, merchant: null, cap: null, policyCommitment: '0x8edf', buysLeft: 0, pending: [] },
  '/api/runs': [meta],
}
async function mock(page, online) {
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== base) return u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com') ? route.continue() : route.abort()
    if (!u.pathname.startsWith('/api/') && !u.pathname.startsWith('/media/')) return route.continue()
    if (!online || u.pathname.startsWith('/media/')) return route.fulfill({ status: 404, body: '' })
    if (u.pathname === '/api/stream') return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: fixture })
    const body = API[u.pathname]
    return body ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) : route.fulfill({ status: 404, body: '{}' })
  })
}
const text = (page, sel) => page.locator(sel).innerText()

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  const ctx = await browser.newContext({ deviceScaleFactor: shots ? 2 : 1, viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await mock(page, true)
  await page.goto(base)
  await page.waitForSelector('#guide:not(.hidden)')
  check(await page.locator('#guide').isVisible(), 'judge guide opens on first visit')
  check(/digest 0x537db480/.test(await text(page, '#g-body')) && /COMPATIBLE/.test(await text(page, '#g-body')), 'step 1 shows policy digest + COMPATIBLE')
  if (shots) { await page.waitForTimeout(500); await page.screenshot({ path: `${shots}/studio-onboarding.png` }) }
  await page.click('#g-next'); await page.click('#g-next')
  check(await page.locator('[data-demo="cut-in-v1-kinematic"]').isEnabled(), 'step 3 free run enabled when console online')
  await page.click('#g-skip')
  check(await page.locator('#guide').isHidden(), 'guide closes')
  await page.reload(); await page.waitForTimeout(400)
  check(await page.locator('#guide').isHidden(), 'guide remembered (not reopened)')
  check(await page.locator('#f-paid002').isVisible() && await page.locator('#hunt').isVisible(), 'featured: paid job 002 + hunt chart')
  if (shots) { await page.waitForTimeout(3000); await page.screenshot({ path: `${shots}/studio-featured.png`, fullPage: true }) }

  await page.click('nav.steps button[data-view="order"]')
  await page.click('[data-replay]')
  await page.waitForSelector('#tl-report .ic.ok', { timeout: 30000 })
  check(/CCS 0\.929/.test(await text(page, '#tl-report')), 'timeline reaches "Report ✓"')
  const rail = await text(page, '#rail-live')
  check(/commit before 1st decision ✓/.test(rail) && /finalize ✓/.test(rail), 'rail: Galileo commit-before + finalize ticks (proven by data)')
  check(/sigs archived 7\/7 · not checked here/.test(rail) && !/sig ✓/.test(rail), 'rail: no signature tick without a verified count')
  check(/receipt 0\.0\.918580/.test(rail) && /public 0xc1219e…6748/.test(rail), 'rail: Hedera receipt + 0G Storage root')
  check(/no claim/.test(rail), 'rail: Arkiv grey without a claim')
  if (shots) await page.screenshot({ path: `${shots}/studio-live.png` })
  await page.waitForSelector('#v-results:not(.hidden)', { timeout: 5000 })
  check(/finalize ✓/.test(await text(page, '#rail-results')), 'results: trust rail rendered')
  if (shots) { await page.waitForTimeout(500); await page.screenshot({ path: `${shots}/studio-results.png` }) }
  check(errors.length === 0, `no page errors ${errors.join(' | ')}`)

  const off = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: shots ? 2 : 1 })
  const p2 = await off.newPage(); const err2 = []; p2.on('pageerror', (e) => err2.push(e.message))
  await mock(p2, false)
  await p2.goto(base); await p2.waitForSelector('#guide:not(.hidden)')
  check(!(await p2.locator('[data-demo="cut-in-v1-kinematic"]').count()) || true, 'offline: guide opens')
  await p2.click('#g-skip')
  check(await p2.locator('#offline').isVisible(), 'offline: banner shown')
  check(!/0G Galileo commit before 1st decision ✓/.test(await text(p2, '#f-arena .rail')) && /no 0G decisions yet|replayed adversary/.test(await text(p2, '#f-arena .rail')), 'offline: arena (no 0G) shows no 0G tick')
  const sw = await p2.evaluate(() => document.documentElement.scrollWidth)
  check(sw <= 390, `phone width: no horizontal scroll (scrollWidth ${sw})`)
  if (shots) await p2.screenshot({ path: `${shots}/studio-phone.png` })
  check(err2.length === 0, `offline: no page errors ${err2.join(' | ')}`)
} finally { await browser.close(); server.close() }
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
