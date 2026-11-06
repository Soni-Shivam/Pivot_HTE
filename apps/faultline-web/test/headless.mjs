// Headless check of the built verifier page: serves dist/, pastes the fixture public JSON, checks the rendering.
// node apps/faultline-web/test/headless.mjs [--root <publicRoot> --shot <png>]   (pre-installed Playwright)
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// PLAYWRIGHT_MODULE / CHROMIUM_PATH let a machine without a global Playwright use a local copy and cached browser
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const dist = new URL('../dist/', import.meta.url).pathname
const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' }
const server = createServer((req, res) => {
  const p = join(dist, (req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]))
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p))
}).listen(0)
const port = server.address().port
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++ }
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  const page = await browser.newPage({ deviceScaleFactor: arg('--shot') ? 2 : 1, viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const root = arg('--root')
  if (root) {
    await page.goto(`http://127.0.0.1:${port}/?root=${root}`)
    await page.waitForSelector('#decisions tbody tr', { timeout: 120000 })
  } else {
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.click('text=Paste a public JSON instead')
    await page.fill('#paste', readFileSync(new URL('./fixture-public.json', import.meta.url), 'utf8'))
    await page.click('#load-paste')
    await page.waitForSelector('#decisions tbody tr')
  }
  const rows = await page.locator('#decisions tbody tr').count()
  const badge = (await page.textContent('#badge')).trim()
  const checks = await page.textContent('#checks')
  check(root ? rows >= 1 : rows === 27, `decisions table rows = ${rows}`)
  check(/^(green|amber|red)/.test(badge), `badge text "${badge}"`)
  check(/metrics recomputed\s*✓/.test(checks) && /file hashes\s*✓/.test(checks), `checks: ${checks.replace(/\s+/g, ' ').trim()}`)
  check(await page.locator('#chart').isVisible() && await page.locator('#anim').isVisible(), 'chart and animation canvases visible')
  // capture before playing: the headless shell fails to capture once the replay animation has run
  if (root) await page.waitForTimeout(4000) // chain read
  if (arg('--shot')) { // the headless shell cannot capture a 2x full page; size the viewport to the page instead
    await page.setViewportSize({ width: 1200, height: await page.evaluate(() => document.body.scrollHeight) })
    await page.screenshot({ path: arg('--shot') })
  }
  await page.click('#play'); await page.waitForTimeout(600)
  check((await page.textContent('#anim-t')) !== '0.00 s', `animation advances (${await page.textContent('#anim-t')})`)
  check(errors.length === 0, `no page errors ${errors.join(' | ')}`)
} finally {
  await browser.close(); server.close()
}
process.exit(failed ? 1 : 0)
