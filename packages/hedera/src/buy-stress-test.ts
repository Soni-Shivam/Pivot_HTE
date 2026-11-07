// CLI: npm run hedera:buy -- <0x-policy-commitment> <suite> [recovery-tx]. The purchase itself lives in buyer.ts.
import 'dotenv/config'
import { buy, buyerConfigFromEnv } from './buyer.ts'

const [policyCommitment, suite, recoveryTx] = process.argv.slice(2)
const result = await buy(buyerConfigFromEnv(), { suite, policyCommitment, recoveryTx })
console.log(JSON.stringify(result, null, 2))
