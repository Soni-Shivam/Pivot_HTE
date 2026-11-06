// Where the worker's attestation evidence comes from. On TEE hardware this is the runtime's API (0G-TAPP
// GetEvidence over its unix socket, or the sealed-sandbox certificate); without a TEE there is no evidence and every
// client refuses to release keys (SECURITY I12). There is deliberately no provider that fabricates evidence.
import type { Hex } from 'viem'

export interface EvidenceProvider {
  readonly runtime: number
  readonly reason?: string
  /** TAPP-style evidence bound to `nonce` (base64 of {quote, cc_eventlog, runtime_data, gpu_evidence}), if any. */
  evidence(nonce?: Hex): Promise<string | undefined>
}

export class NoTeeEvidence implements EvidenceProvider {
  readonly runtime = 0
  constructor(readonly reason = 'this host has no TEE hardware') {}
  async evidence() {
    return undefined
  }
}
