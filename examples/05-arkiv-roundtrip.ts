// Proves (T01): we can write an entity to Arkiv Rabdi with our access key and query it back by creator.
import 'dotenv/config'
import { ExpirationTime } from '@arkiv-network/sdk'
import { defineSchema, str, u64 } from '@arkiv-network/sdk/schema'
import { eq } from '@arkiv-network/sdk/query'
import { arkiv } from '@sealedai/integrations'

const Probe = defineSchema('sealedai.probe/v1', { tag: str().indexed(), at: u64() })
const { publicClient, walletClient, account } = arkiv(process.env.ARKIV_API_KEY!, process.env.PRIVATE_KEY!)
const tag = `probe-${Date.now()}`

const res = await walletClient!.createEntity(Probe, { tag, at: u64(BigInt(Date.now())) }, { expiration: ExpirationTime.fromHours(1) })
console.log('entityKey', res.entityKey, 'tx', (res as { txHash?: string }).txHash ?? '(see receipt)')

const { entities } = await publicClient.select({ $key: true, tag: true }).from(Probe).where(eq('tag', tag)).createdBy(account!.address).fetch()
const hit = entities.some((e) => e.$key === res.entityKey)
console.log('queryHit', hit, 'writer', account!.address)
if (!hit) process.exit(1)
