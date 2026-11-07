import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { clientIp, DailyCaps, mediaPath, parseOrigins, RateLimit } from '../src/console-guard.ts'

const ROOT = resolve(import.meta.dirname, '../../..')

test('daily caps stop at the limit, persist across restarts and reset on a new UTC day', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'caps-')), 'caps.json')
  let now = new Date('2026-11-07T10:00:00Z')
  const c = new DailyCaps(f, 2, 1, () => now)
  assert.ok(c.take('buys')); assert.ok(c.take('buys')); assert.equal(c.take('buys'), false)
  assert.ok(c.take('runs')); assert.equal(c.take('runs'), false)
  assert.deepEqual(new DailyCaps(f, 2, 1, () => now).left(), { buys_left: 0, runs_left: 0 })
  now = new Date('2026-11-08T00:00:01Z')
  assert.deepEqual(c.left(), { buys_left: 2, runs_left: 1 })
})

test('rate limit is per key and per window', () => {
  let t = 0
  const r = new RateLimit(2, 1000, () => t)
  assert.ok(r.allow('a')); assert.ok(r.allow('a')); assert.equal(r.allow('a'), false); assert.ok(r.allow('b'))
  t = 1000; assert.ok(r.allow('a'))
})

test('client ip comes from X-Forwarded-For only behind the loopback proxy', () => {
  assert.equal(clientIp('127.0.0.1', '1.2.3.4, 10.0.0.1'), '1.2.3.4')
  assert.equal(clientIp('::1', undefined), 'local')
  assert.equal(clientIp('5.6.7.8', '1.2.3.4'), '5.6.7.8')
  assert.deepEqual([...parseOrigins(' https://a.vercel.app/ ,http://localhost:5173,')], ['https://a.vercel.app', 'http://localhost:5173'])
})

test('media allowlist serves videos and run media only, never secrets or json', () => {
  assert.equal(mediaPath(ROOT, 'videos/does-not-exist.mp4'), null)
  for (const bad of ['.env', 'videos/../.env', 'runs/demo-003/anchor.json', 'runs/demo-003/sealed.bin', 'runs/demo-003/manifest.json',
    'packages/hedera/src/buyer.ts', 'runs/x/permit.png', 'runs/.hidden/a.mp4', '/etc/passwd']) assert.equal(mediaPath(ROOT, bad), null, bad)
})

test('public console: host check, CORS allowlist, console header, POST rate limit, media 404', async (t) => {
  const port = 18000 + Math.floor(Math.random() * 900)
  const child = spawn(resolve(ROOT, 'node_modules/.bin/tsx'), ['packages/hedera/src/agent-console.ts'], { cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, FAULTLINE_CONSOLE_PORT: String(port), FAULTLINE_PUBLIC_ORIGINS: 'https://ok.example', FAULTLINE_RATE_POST: '3' } })
  t.after(() => child.kill())
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/health`); break } catch { await new Promise((r) => setTimeout(r, 250)) } }
  const h = await (await fetch(`${base}/api/health`)).json() as any
  assert.equal(h.ok, true); assert.equal(typeof h.caps.buys_left, 'number'); assert.equal(typeof h.queue.waiting, 'number')
  // Host header must be ours (DNS rebinding guard); undici forbids setting Host, so use a raw request
  const { request } = await import('node:http')
  const status = await new Promise<number>((done) => request({ port, host: '127.0.0.1', path: '/api/health', headers: { host: 'evil.example' } }, (r) => { r.resume(); done(r.statusCode!) }).end())
  assert.equal(status, 421)
  const pre = await fetch(`${base}/api/demo-run`, { method: 'OPTIONS', headers: { origin: 'https://ok.example', 'access-control-request-method': 'POST' } })
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://ok.example')
  const bad = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } })
  assert.equal(bad.headers.get('access-control-allow-origin'), null)
  const post = (headers: Record<string, string>) => fetch(`${base}/api/demo-run`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ policy: 'nope' }) })
  assert.equal((await post({ origin: 'https://evil.example', 'x-faultline-console': '1' })).status, 403)
  assert.equal((await post({ origin: 'https://ok.example' })).status, 403) // no console header
  assert.equal((await post({ origin: 'https://ok.example', 'x-faultline-console': '1' })).status, 400) // validated, nothing spent
  assert.equal((await post({ 'x-faultline-console': '1' })).status, 429) // 4th POST this minute from this ip
  assert.equal((await fetch(`${base}/media/runs/demo-003/anchor.json`)).status, 404)
  assert.equal((await fetch(`${base}/media/.env`)).status, 404)
  const pol = await (await fetch(`${base}/api/policies`)).json() as any[]
  assert.deepEqual(pol.map((p) => p.id), ['pdm-lite', 'idm-cautious'])
})

test('signed run requests: valid once, fresh, matching, and from the signing wallet', async () => {
  const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts')
  const { verifyMessage } = await import('viem')
  const { requestMessage, verifyRunRequest, WalletCaps } = await import('../src/console-guard.ts')
  const acct = privateKeyToAccount(generatePrivateKey()), now = Date.parse('2026-11-07T10:00:00Z')
  const want = { policy: 'pdm-lite', suite: 'cut-in-v1-kinematic', mode: 'free' }
  const message = requestMessage({ ...want, nonce: 'ab'.repeat(8), issued: new Date(now - 1000).toISOString() })
  const signature = await acct.signMessage({ message }), seen = new Map<string, number>()
  const ok = await verifyRunRequest({ address: acct.address, message, signature }, want, seen, verifyMessage, now)
  assert.deepEqual(ok, { address: acct.address.toLowerCase() })
  assert.match((await verifyRunRequest({ address: acct.address, message, signature }, want, seen, verifyMessage, now) as any).error, /already used/)
  assert.match((await verifyRunRequest({}, want, new Map(), verifyMessage, now) as any).error, /unsigned/)
  assert.match((await verifyRunRequest({ address: acct.address, message, signature }, { ...want, mode: 'paid' }, new Map(), verifyMessage, now) as any).error, /does not match/)
  assert.match((await verifyRunRequest({ address: acct.address, message, signature }, want, new Map(), verifyMessage, now + 6 * 60_000) as any).error, /expired/)
  const other = privateKeyToAccount(generatePrivateKey()).address
  assert.match((await verifyRunRequest({ address: other, message, signature }, want, new Map(), verifyMessage, now) as any).error, /does not match the wallet/)
  const w = new WalletCaps(2); assert.ok(w.take('a')); assert.ok(w.take('a')); assert.equal(w.take('a'), false); assert.ok(w.take('b'))
})
