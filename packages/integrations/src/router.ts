// 0G Private Computer Router adapter for the customization agent. Private (TEE-only) tier ONLY, never another tier
// (SECURITY I9). Only the agent uses it, and the agent's prompts carry aggregates only (I9, D10).
import { TierUnavailableError, type Llm, type Msg } from '@sealedai/planner'

export type RouterOptions = { baseUrl: string; apiKey: string; model?: string; maxTokens?: number; fetch?: typeof fetch }
export const DEFAULT_PRIVATE_MODEL = '0gm-1.0-35b-a3b' // the only TeeML chat model in /v1/models on 2026-11-06

export function routerLlm(o: RouterOptions): Llm {
  const f = o.fetch ?? fetch
  return {
    async next(messages: Msg[]) {
      const res = await f(`${o.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}`, 'X-0G-Provider-Trust-Mode': 'private' },
        body: JSON.stringify({
          model: o.model ?? DEFAULT_PRIVATE_MODEL,
          messages,
          max_tokens: o.maxTokens ?? 700,
          temperature: 0,
          chat_template_kwargs: { enable_thinking: false }, // 0gm thinks by default and burns the token budget
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string }
        choices?: { message?: { content?: string } }[]
        x_0g_trace?: { request_id?: string; provider?: string }
      }
      if (res.status === 503 && body.error?.code === 'no_provider_for_trust_mode') throw new TierUnavailableError(body.error.message)
      if (!res.ok) throw new Error(`router HTTP ${res.status}: ${body.error?.code ?? ''} ${body.error?.message ?? ''}`.trim())
      const text = body.choices?.[0]?.message?.content?.trim()
      if (!text) throw new Error('router returned empty content')
      const requestId = res.headers.get('x-request-id') ?? body.x_0g_trace?.request_id
      if (!requestId) throw new Error('router response has no request ID')
      return { text, requestId, provider: body.x_0g_trace?.provider }
    },
  }
}
