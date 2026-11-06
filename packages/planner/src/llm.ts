export type Msg = { role: 'system' | 'user' | 'assistant'; content: string }
export interface Llm {
  next(messages: Msg[]): Promise<{ text: string; requestId: string; provider?: string }>
}
/** The private (TEE-only) tier has no provider right now. Callers must stop; never retry on another tier (I9). */
export class TierUnavailableError extends Error {
  constructor(msg = 'no TEE provider available for private trust mode') {
    super(msg)
    this.name = 'TierUnavailableError'
  }
}
