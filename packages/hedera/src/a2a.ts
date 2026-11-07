import { randomUUID } from 'node:crypto'
import type { Express } from 'express'

type Terms = { phase: 'propose' | 'accept'; suites: string[]; maxAmount: string; asset: string; selectedSuite?: string }
type Offer = { phase: 'offer' | 'accepted' | 'rejected'; suites: string[]; amount: string; asset: string; selectedSuite?: string; reason?: string }

export function registerNegotiator(app: Express, config: { amount: string; asset: string; suites: string[]; port: number }) {
  const pending = new Map<string, { suite: string; expiresAt: number }>()
  app.get('/.well-known/agent-card.json', (req, res) => res.json({
    protocolVersion: '0.3.0', name: 'Faultline test provider', version: '1.0.0',
    description: 'Negotiates bounded physical-AI scenario testing before Hedera x402 payment.',
    url: `${req.protocol}://${req.get('host') ?? `127.0.0.1:${config.port}`}/a2a`, preferredTransport: 'JSONRPC',
    capabilities: { streaming: false, pushNotifications: false }, defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [{ id: 'negotiate-scenario-test', name: 'Negotiate scenario test',
      description: 'Agree on an available test suite, payment asset, and maximum price before x402.',
      tags: ['physical-ai', 'scenario-testing', 'x402'] }],
  }))
  app.post('/a2a', (req, res) => {
    for (const [id, offer] of pending) if (offer.expiresAt <= Date.now()) pending.delete(id)
    const rpc = req.body as { jsonrpc?: string; id?: string | number; method?: string; params?: { message?: { contextId?: string; parts?: Array<{ kind?: string; data?: Terms }> } } }
    if (rpc?.jsonrpc !== '2.0' || rpc.method !== 'message/send' || rpc.id === undefined) {
      res.status(400).json({ jsonrpc: '2.0', id: rpc?.id ?? null, error: { code: -32600, message: 'Invalid A2A request' } }); return
    }
    const terms = rpc.params?.message?.parts?.find(p => p.kind === 'data')?.data
    const valid = terms && Array.isArray(terms.suites) && terms.suites.length > 0 && terms.suites.every(x => typeof x === 'string') &&
      /^(0|[1-9][0-9]*)$/.test(terms.maxAmount) && typeof terms.asset === 'string'
    if (!valid || (terms.phase !== 'propose' && terms.phase !== 'accept')) {
      res.status(400).json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'Invalid negotiation terms' } }); return
    }
    const candidates = terms.suites.filter(x => config.suites.includes(x))
    const affordable = terms.asset === config.asset && BigInt(terms.maxAmount) >= BigInt(config.amount)
    const selected = candidates[0]
    const prior = pending.get(rpc.params?.message?.contextId ?? '')
    const accepted = terms.phase === 'accept' && terms.selectedSuite === selected && affordable &&
      prior?.suite === selected && prior.expiresAt > Date.now()
    const contextId = terms.phase === 'propose' ? randomUUID() : rpc.params?.message?.contextId
    if (terms.phase === 'propose' && selected && affordable) pending.set(contextId!, { suite: selected, expiresAt: Date.now() + 60_000 })
    if (accepted) pending.delete(contextId!)
    const offer: Offer = !selected || !affordable || (terms.phase === 'accept' && !accepted)
      ? { phase: 'rejected', suites: [], amount: config.amount, asset: config.asset, reason: 'No available suite within asset and budget' }
      : { phase: accepted ? 'accepted' : 'offer', suites: candidates, amount: config.amount, asset: config.asset,
          selectedSuite: selected }
    res.json({ jsonrpc: '2.0', id: rpc.id, result: { role: 'agent', messageId: randomUUID(),
      contextId, parts: [{ kind: 'data', data: offer }], kind: 'message' } })
  })
}

/** Buyer and provider exchange a proposal, offer, and acceptance before any signature. */
export async function negotiate(base: string, preferredSuites: string[], maxAmount: string, asset: string): Promise<string> {
  const cardResponse = await fetch(`${base}/.well-known/agent-card.json`)
  if (!cardResponse.ok) throw new Error('A2A agent card unavailable')
  const card = await cardResponse.json() as { protocolVersion: string; preferredTransport: string; url: string }
  if (card.protocolVersion !== '0.3.0' || card.preferredTransport !== 'JSONRPC' ||
      new URL(card.url).origin !== new URL(base).origin) throw new Error('Unsupported A2A provider')
  const send = async (terms: Terms, contextId?: string): Promise<{ offer: Offer; contextId?: string }> => {
    const response = await fetch(card.url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'message/send', params: {
        message: { role: 'user', messageId: randomUUID(), contextId, parts: [{ kind: 'data', data: terms }] },
      } }) })
    const body = await response.json() as { result?: { contextId?: string; parts?: Array<{ kind?: string; data?: Offer }> }; error?: { message: string } }
    if (!response.ok || !body.result) throw new Error(body.error?.message ?? 'A2A negotiation failed')
    const offer = body.result.parts?.find(x => x.kind === 'data')?.data
    if (!offer) throw new Error('A2A offer missing')
    return { offer, contextId: body.result.contextId }
  }
  const proposal: Terms = { phase: 'propose', suites: preferredSuites, maxAmount, asset }
  const { offer, contextId } = await send(proposal)
  if (offer.phase !== 'offer' || !offer.selectedSuite || !preferredSuites.includes(offer.selectedSuite) ||
      offer.asset !== asset || BigInt(offer.amount) > BigInt(maxAmount) || !contextId) throw new Error('Provider offer outside buyer policy')
  const { offer: acceptance } = await send({ ...proposal, phase: 'accept', selectedSuite: offer.selectedSuite }, contextId)
  if (acceptance.phase !== 'accepted' || acceptance.selectedSuite !== offer.selectedSuite ||
      acceptance.amount !== offer.amount || acceptance.asset !== asset) throw new Error('A2A terms not accepted')
  return acceptance.selectedSuite
}
