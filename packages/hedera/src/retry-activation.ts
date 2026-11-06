import 'dotenv/config'
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file || !/activation-0-0-[0-9-]+\.json$/.test(file)) throw new Error('Pass the saved activation JSON path')
const body = readFileSync(file, 'utf8')
const base = `http://127.0.0.1:${process.env.HEDERA_DEMO_PORT ?? '8787'}`
const response = await fetch(`${base}/v1/stress-tests/activate`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body,
})
if (!response.ok) throw new Error(`Activation retry failed: HTTP ${response.status}`)
console.log(JSON.stringify(await response.json(), null, 2))
