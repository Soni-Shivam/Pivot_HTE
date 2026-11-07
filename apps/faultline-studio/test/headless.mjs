// Headless check of the built Studio: mocks the agent console API and an injected EIP-1193 wallet (throwaway viem key,
// announced via EIP-6963), walks the guided flow (connect → policy → attack → signed request → live → results) on the
// fixture run (paid job 002, CARLA), and checks the trust rail shows only proven ticks.
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
const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts')
const { verifyMessage } = await import('viem')
const acct = privateKeyToAccount(generatePrivateKey())
let signedBody = null
async function mock(page, online) {
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== base) return u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com') ? route.continue() : route.abort()
    if (!u.pathname.startsWith('/api/') && !u.pathname.startsWith('/media/')) return route.continue()
    if (!online || u.pathname.startsWith('/media/')) return route.fulfill({ status: 404, body: '' })
    if (u.pathname === '/api/demo-run') {
      const b = JSON.parse(route.request().postData() ?? '{}')
      if (!b.signature) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unsigned' }) })
      signedBody = b
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'fixture-job', queuePos: 0 }) })
    }
    if (u.pathname === '/api/stream') return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: fixture })
    const body = API[u.pathname]
    return body ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) : route.fulfill({ status: 404, body: '{}' })
  })
}
const text = (page, sel) => page.locator(sel).innerText()

async function wallet(page) {
  await page.exposeFunction('__fixtureSign', (hex) => acct.signMessage({ message: { raw: hex } }))
  await page.addInitScript((address) => {
    const provider = { request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts') return [address]
      if (method === 'personal_sign') return window.__fixtureSign(params[0])
      throw new Error(`unexpected wallet call ${method}`) } }
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider',
      { detail: { info: { uuid: 'fixture', name: 'Fixture Wallet', icon: '', rdns: 'test.fixture' }, provider } })))
  }, acct.address)
}
const shot = async (page, name, full = false) => { if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: `${shots}/studio-v2-${name}.png`, fullPage: full }) } }

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  const ctx = await browser.newContext({ deviceScaleFactor: shots ? 2 : 1, viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(e.message))
  await mock(page, true); await wallet(page)
  await page.goto(base)
  await page.waitForSelector('#console-dot.up')
  check(/AI attackers/.test(await text(page, '#v-home h1')), 'hero: one-sentence product line')
  check(await page.locator('#v-home video').count() === 1, 'hero: exactly one video on the landing view')
  check(await page.locator('#v-home .how li').count() === 4, 'hero: 4-step how it works')
  await shot(page, 'home')
  await page.click('#cta-run')
  check(await page.locator('#s1').isVisible() && await page.locator('#s1-next').isDisabled(), 'step 1: connect wallet first')
  check(/never a transaction/.test(await text(page, '#s1')), 'step 1: signature-only note')
  await page.click('[data-w="0"]')
  await page.waitForSelector('#s1-next:not([disabled])')
  check((await text(page, '#wallet-btn')).includes(acct.address.slice(0, 6)), 'wallet connected: address shown')
  await shot(page, 'connect')
  await page.click('#s1-next')
  check((await page.locator('#policies .choice').count()) === 2, 'step 2: two policies')
  await page.click('#s2-next')
  await page.click('[data-mode="paid"]')
  check(/Paid · our agent pays/.test(await text(page, '#summary')), 'step 3: paid run summary')
  await shot(page, 'attack')
  await page.click('#start')
  await page.waitForSelector('#s4:not(.hidden)')
  check(!!signedBody && await verifyMessage({ address: signedBody.address, message: signedBody.message, signature: signedBody.signature }), 'signed request: EIP-191 signature verifies for the wallet')
  check(/^Faultline test request\npolicy: pdm-lite\nsuite: cut-in-v1-kinematic\nmode: paid\nnonce: [0-9a-f]{32}\nissued: \S+$/.test(signedBody?.message ?? ''), 'signed request: readable message format')
  await page.waitForSelector('#pg-report .ic.ok', { timeout: 30000 })
  check(/answered by 0G/.test(await text(page, '#feed')), 'live: decision feed in plain words')
  await shot(page, 'live')
  await page.waitForSelector('#s5:not(.hidden)', { timeout: 5000 })
  check(/^Survived/.test(await text(page, '#verdict h2')), 'results: verdict in words first')
  const rail = await text(page, '#rail-results')
  check(/Committed before the first move ✓/.test(rail) && /result matches ✓/.test(rail), 'rail: Galileo commit-before + finalize ticks (proven by data)')
  check(/signatures not checked here/.test(rail), 'rail: no signature tick without a verified count')
  check(/Paid · 0\.0\.918580/.test(rail) && /root 0xc121…6748/.test(rail), 'rail: Hedera receipt + 0G Storage root')
  check(/No public claim/.test(rail), 'rail: Arkiv grey without a claim')
  await shot(page, 'results', true)
  await page.click('nav.top button[data-view="explore"]')
  await page.waitForSelector('#runs [data-replay]')
  check(await page.locator('#x-paid002').isVisible() && await page.locator('#hunt').isVisible(), 'explore: paid test + research chart')
  check(!(await page.locator('#v-explore').innerText()).includes('source:'), 'explore: no scattered source footnotes')
  await shot(page, 'explore', true)
  check(errors.length === 0, `no page errors ${errors.join(' | ')}`)

  const off = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: shots ? 2 : 1 })
  const p2 = await off.newPage(); const err2 = []; p2.on('pageerror', (e) => err2.push(e.message))
  await mock(p2, false)
  await p2.goto(base); await p2.waitForSelector('#console-dot.down', { state: 'attached' })
  check(await p2.locator('#offline').isVisible(), 'offline: banner shown')
  const sw = await p2.evaluate(() => document.documentElement.scrollWidth)
  check(sw <= 390, `phone width: no horizontal scroll (scrollWidth ${sw})`)
  await shot(p2, 'phone', true)
  await p2.click('#cta-run')
  check(/No wallet found/.test(await text(p2, '#wallets')), 'no wallet: install hint + recorded-test path')
  const sw2 = await p2.evaluate(() => document.documentElement.scrollWidth)
  check(sw2 <= 390, `phone flow: no horizontal scroll (scrollWidth ${sw2})`)
  await shot(p2, 'phone-flow')
  check(err2.length === 0, `offline: no page errors ${err2.join(' | ')}`)
} finally { await browser.close(); server.close() }
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
