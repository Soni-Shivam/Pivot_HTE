// Proves: the 0G Router serves an OpenAI-compatible chat call routed only to TEE providers (X-0G-Provider-Trust-Mode: private).
import 'dotenv/config'

const { ZG_ROUTER_URL: base, ZG_API_KEY } = process.env
const { data } = await (await fetch(`${base}/models`)).json() as { data: any[] }
// /models exposes `tee_attested: true` (+ verifiability "TeeML") for TEE-backed models
const models = data.filter((m) => m.type === 'chatbot' && m.tee_attested).map((m) => m.id)
console.log('models with tee_attested=true:', models.join(', '))

const body = (model: string) => JSON.stringify({
  model, max_tokens: 200, chat_template_kwargs: { enable_thinking: false }, // 0GM thinks by default and would eat the token budget
  messages: [{ role: 'user', content: 'Reply with ONLY a JSON object suggesting a LoRA fine-tuning config for a small sentiment dataset: keys epochs, learning_rate, batch_size, lora_rank.' }],
})

async function call(model: string, mode: 'private' | 'verified') {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ZG_API_KEY}`, 'X-0G-Provider-Trust-Mode': mode },
    body: body(model),
  })
  return { res, json: await res.json().catch(() => ({})) as any }
}

let used: { model: string; mode: string; res: Response; json: any } | undefined
for (const mode of ['private', 'verified'] as const) {
  for (const model of models) {
    const r = await call(model, mode)
    console.log(`tried model=${model} mode=${mode} -> HTTP ${r.res.status}${r.json?.error?.code ? ' ' + r.json.error.code : ''}`)
    if (r.res.ok) { used = { model, mode, ...r }; break }
    if (r.json?.error?.code !== 'no_provider_for_trust_mode') break // other errors: don't burn calls
  }
  if (used) break
  if (mode === 'private') console.log('FALLBACK: private mode unavailable, retrying with trust mode "verified"')
}
if (!used) throw new Error('no model succeeded')

console.log(`\nTRUST MODE USED: ${used.mode.toUpperCase()}${used.mode === 'verified' ? ' (fallback, NOT private)' : ''}`)
console.log('model:', used.model)
console.log('X-Request-ID:', used.res.headers.get('x-request-id'))
console.log('x_0g_trace:', JSON.stringify(used.json.x_0g_trace ?? null))
console.log('response:', used.json.choices?.[0]?.message?.content)
