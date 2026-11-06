// processResponse over every line of a JSONL log that carries `provider` and `zg_res_key` (e.g. a hunt's
// designer.jsonl). Lines without them are skipped; `cp` is the line's index `i`.
import { verifySignatures, type ProcessResponse, type Signature } from './verify.ts'

export async function jsonlSignatures(text: string, pr: ProcessResponse): Promise<{ total: number; verified: number; signatures: Signature[] }> {
  const rows = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    .filter((d) => d.provider && d.zg_res_key)
    .map((d) => ({ ...d, cp: d.i, source: '0g' }))
  const signatures = await verifySignatures(rows, pr)
  return { total: signatures.length, verified: signatures.filter((s) => s.verified === true).length, signatures }
}
