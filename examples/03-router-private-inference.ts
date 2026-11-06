// Proves: the 0G Router serves a chat call on the PRIVATE (TEE-only) tier. Private only: if no TEE provider is
// available it exits non-zero and does NOT retry on another tier (SECURITY I9; review R13).
import 'dotenv/config'
import { routerLlm } from '@sealedai/integrations'
import { TierUnavailableError } from '@sealedai/planner'

const { ZG_ROUTER_URL, ZG_API_KEY } = process.env
const { data } = (await (await fetch(`${ZG_ROUTER_URL}/models`)).json()) as { data: { id: string; type: string; tee_attested?: boolean; verifiability?: string }[] }
console.log('TeeML chat models:', data.filter((m) => m.type === 'chatbot' && m.verifiability === 'TeeML').map((m) => m.id).join(', '))

try {
  const r = await routerLlm({ baseUrl: ZG_ROUTER_URL!, apiKey: ZG_API_KEY!, maxTokens: 120 }).next([
    { role: 'user', content: 'Reply with ONLY a JSON object {"ok": true, "tier": "private"}.' },
  ])
  console.log('TRUST MODE: private\nX-Request-ID:', r.requestId, '\nprovider:', r.provider, '\nresponse:', r.text)
} catch (e) {
  if (e instanceof TierUnavailableError) {
    console.error('PRIVATE TIER UNAVAILABLE (no TEE provider). Not retrying on another tier.')
    process.exit(2)
  }
  throw e
}
