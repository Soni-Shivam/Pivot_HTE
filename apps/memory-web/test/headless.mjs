// Headless check of the built memory dashboard against live Arkiv + Galileo; optional screenshot.
// node apps/memory-web/test/headless.mjs [--shot <png>]   (PLAYWRIGHT_MODULE / CHROMIUM_PATH as in apps/faultline-web)
// ARKIV_WEB_KEY, if set in the environment, is typed into the page's key field (never printed); else the public endpoint.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const dist = new URL('../dist/', import.meta.url).pathname
const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' }
const server = createServer((req, res) => {
  const p = join(dist, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0])
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p))
}).listen(0)
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++ }
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  const page = await browser.newPage({ deviceScaleFactor: arg('--shot') ? 2 : 1, viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  if (process.env.ARKIV_WEB_KEY) {
    await page.waitForFunction(() => document.body.dataset.loaded || /claim entities|bad/.test(document.getElementById('status').innerHTML), null, { timeout: 120000 })
    await page.fill('#akey', process.env.ARKIV_WEB_KEY)
    await page.evaluate(() => { delete document.body.dataset.loaded })
    await page.click('#load')
  }
  await page.waitForFunction(() => document.body.dataset.loaded === '1' || document.querySelector('#status .bad'), null, { timeout: 120000 })
  console.log(`status: ${(await page.textContent('#status')).trim()}`)
  console.log(`query: ${(await page.textContent('#query')).trim()}`)
  const cmp = await page.locator('#compare tbody tr').count()
  const anchors = await page.locator('#anchors tbody tr').count()
  const claims = await page.locator('#claims tbody tr').count()
  check(cmp >= 4, `comparison rows = ${cmp}`)
  check(anchors >= 2, `anchor rows = ${anchors}`)
  check(claims >= 8, `claim rows = ${claims}`)
  check(!(await page.textContent('#anchors')).includes('✗') && !(await page.textContent('#claims')).includes('✗'), 'anchor chain and claim roots all ✓')
  check(errors.length === 0, `page errors: ${errors.join('; ') || 'none'}`)
  console.log((await page.textContent('#compare tbody')).replace(/\s+/g, ' ').slice(0, 600))
  if (arg('--shot')) { await page.screenshot({ path: arg('--shot'), fullPage: true }); console.log(`screenshot ${arg('--shot')}`) }
} finally {
  await browser.close()
  server.close()
}
process.exit(failed ? 1 : 0)
