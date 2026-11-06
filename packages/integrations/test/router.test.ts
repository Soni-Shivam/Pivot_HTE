import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TierUnavailableError } from '@sealedai/planner'
import { routerLlm } from '../src/router.ts'

type Call = { url: string; init: RequestInit }
function stub(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers })
  }) as unknown as typeof fetch
  return { f, calls }
}
const ok = { choices: [{ message: { content: '{"tool":"inspect_data_summary","args":{}}' } }], x_0g_trace: { request_id: 'trace-1', provider: '0xP' } }
const msgs = [{ role: 'user' as const, content: 'hi' }]

test('sendsPrivateHeaderOnly', async () => {
  const s = stub(200, ok, { 'x-request-id': 'hdr-1' })
  const r = await routerLlm({ baseUrl: 'https://r/v1/', apiKey: 'k', fetch: s.f }).next(msgs)
  assert.equal(r.requestId, 'hdr-1')
  assert.equal(s.calls[0].url, 'https://r/v1/chat/completions')
  const h = s.calls[0].init.headers as Record<string, string>
  assert.equal(h['X-0G-Provider-Trust-Mode'], 'private')
  assert.equal(JSON.parse(s.calls[0].init.body as string).chat_template_kwargs.enable_thinking, false)
})

test('503NoRetry', async () => {
  const s = stub(503, { error: { code: 'no_provider_for_trust_mode', message: 'none' } })
  await assert.rejects(routerLlm({ baseUrl: 'https://r/v1', apiKey: 'k', fetch: s.f }).next(msgs), TierUnavailableError)
  assert.equal(s.calls.length, 1)
})

test('emptyContentThrows', async () => {
  const s = stub(200, { choices: [{ message: { content: '  ' } }], x_0g_trace: { request_id: 't' } })
  await assert.rejects(routerLlm({ baseUrl: 'https://r/v1', apiKey: 'k', fetch: s.f }).next(msgs), /empty content/)
})

test('missingRequestIdThrows', async () => {
  const s = stub(200, { choices: ok.choices })
  await assert.rejects(routerLlm({ baseUrl: 'https://r/v1', apiKey: 'k', fetch: s.f }).next(msgs), /no request ID/)
})

test('otherErrorsSurface', async () => {
  const s = stub(401, { error: { code: 'unauthorized', message: 'bad key' } })
  await assert.rejects(routerLlm({ baseUrl: 'https://r/v1', apiKey: 'k', fetch: s.f }).next(msgs), /401/)
})
