// Run a worker locally WITHOUT a TEE (development only). Every production client refuses it: there is no evidence,
// so no key is ever released to it (SECURITY I12). On TEE hardware the same code runs with a real EvidenceProvider.
//   npx tsx examples/12-dev-worker.ts [port]
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { createWorker, NoTeeEvidence } from '@sealedai/worker'

const port = Number(process.argv[2] ?? 8787)
const w = createWorker({
  rpcUrl: process.env.RPC_URL!, storageIndexer: process.env.STORAGE_INDEXER!, routerUrl: process.env.ZG_ROUTER_URL!,
  imageDigest: `sha256:${createHash('sha256').update('sealedai-worker-dev').digest('hex')}`,
  evidence: new NoTeeEvidence('development worker on a host without TEE hardware'),
})
await w.listen(port)
console.log(`dev worker ${w.address} on http://127.0.0.1:${port} (NO TEE: clients will refuse it)`)
