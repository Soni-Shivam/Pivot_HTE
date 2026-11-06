// npm run faultline -- publish <dir> | verify <publicRoot> [--sealed <root> --key <hex>] [--out file] | sigs <jsonl>
// Env from .env: RPC_URL, STORAGE_INDEXER, PRIVATE_KEY, FAULTLINE_TENANT_KEY. Values are never printed.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { publish } from './publish.ts'
import { makeProcessResponse, verify } from './verify.ts'
import { jsonlSignatures } from './sigs.ts'
import { commit, finalize } from './anchor.ts'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} missing in .env`); return v }
const flag = (args: string[], f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }

const [cmd, target, ...rest] = process.argv.slice(2)
const base = () => ({ rpcUrl: env('RPC_URL'), indexerUrl: env('STORAGE_INDEXER') })

if (cmd === 'publish' && target) {
  console.log(JSON.stringify(await publish(target, { ...base(), privateKey: env('PRIVATE_KEY'), tenantKeyHex: env('FAULTLINE_TENANT_KEY') }), null, 2))
} else if ((cmd === 'commit' || cmd === 'finalize') && target) {
  const cfg = { rpcUrl: env('RPC_URL'), privateKey: env('PRIVATE_KEY') }
  console.log(JSON.stringify(await (cmd === 'commit' ? commit(target, cfg) : finalize(target, cfg)), null, 2))
} else if (cmd === 'verify' && target) {
  const key = flag(rest, '--key')
  const v = await verify(target, { ...base(), sealedRoot: flag(rest, '--sealed'), tenantKeyHex: key === 'env' ? env('FAULTLINE_TENANT_KEY') : key })
  const out = flag(rest, '--out')
  if (out) writeFileSync(out, JSON.stringify(v, null, 2) + '\n')
  console.log(JSON.stringify(v, null, 2))
} else if (cmd === 'sigs' && target) {
  const r = await jsonlSignatures(readFileSync(target, 'utf8'), await makeProcessResponse())
  writeFileSync(`${target}.sigs.json`, JSON.stringify(r, null, 2) + '\n')
  console.log(JSON.stringify({ total: r.total, verified: r.verified, out: `${target}.sigs.json` }))
} else {
  console.error('usage: faultline commit|publish|finalize <dir> | verify <publicRoot> [--sealed <root> --key <hex|env>] [--out file] | sigs <jsonl>')
  process.exit(2)
}
process.exit(0)
