// npm run memory -- publish <snapDir> | anchor <snapDir> | verify <publicRoot> <sealedRoot> [--out file]
//                  | arkiv-publish <snapDir> | arkiv-query [--model m] [--version v] [--category c] [--owner 0x..]
// Env from .env: RPC_URL, STORAGE_INDEXER, PRIVATE_KEY, FAULTLINE_TENANT_KEY, ARKIV_RPC_URL, ARKIV_API_KEY. Never printed.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import type { Hex } from 'viem'
import { anchor, arkivPublish, arkivQuery, publish, verify, type Env } from './node.ts'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} missing in .env`); return v }
const flag = (args: string[], f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const [cmd, ...args] = process.argv.slice(2)
const base = (): Env => ({ rpcUrl: env('RPC_URL'), indexerUrl: env('STORAGE_INDEXER') })
const print = (x: unknown) => console.log(JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2))

if (cmd === 'publish' && args[0]) print(await publish(args[0], { ...base(), privateKey: env('PRIVATE_KEY'), tenantKeyHex: env('FAULTLINE_TENANT_KEY') }))
else if (cmd === 'anchor' && args[0]) print(await anchor(args[0], { ...base(), privateKey: env('PRIVATE_KEY') }))
else if (cmd === 'verify' && args[0] && args[1]) {
  const v = await verify(args[0], args[1], { ...base(), tenantKeyHex: env('FAULTLINE_TENANT_KEY') })
  const out = flag(args, '--out')
  if (out) writeFileSync(out, JSON.stringify(v, null, 2) + '\n')
  print(v)
  if (!v.ok) process.exit(1)
} else if (cmd === 'arkiv-publish' && args[0]) print(await arkivPublish(args[0], { ...base(), privateKey: env('PRIVATE_KEY'), arkivRpcUrl: env('ARKIV_RPC_URL'), arkivKey: env('ARKIV_API_KEY') }))
else if (cmd === 'arkiv-query') {
  print(await arkivQuery({ ...base(), arkivRpcUrl: env('ARKIV_RPC_URL'), arkivKey: env('ARKIV_API_KEY') },
    { model: flag(args, '--model'), version: flag(args, '--version'), category: flag(args, '--category'), owner: flag(args, '--owner') as Hex | undefined }))
} else {
  console.error('usage: memory publish|anchor|arkiv-publish <snapDir> | verify <publicRoot> <sealedRoot> [--out f] | arkiv-query [--model m] [--version v] [--category c] [--owner 0x..]')
  process.exit(2)
}
process.exit(0)
