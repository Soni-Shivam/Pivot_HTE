import 'dotenv/config'
import { Client, PrivateKey, TopicCreateTransaction } from '@hiero-ledger/sdk'

const accountId = process.env.HEDERA_HCS_OPERATOR_ACCOUNT_ID
const key = process.env.HEDERA_HCS_OPERATOR_PRIVATE_KEY
if (!accountId || !key) throw new Error('Set HEDERA_HCS_OPERATOR_ACCOUNT_ID and HEDERA_HCS_OPERATOR_PRIVATE_KEY')
const operatorKey = PrivateKey.fromStringECDSA(key.replace(/^0x/, ''))
const client = Client.forTestnet().setOperator(accountId, operatorKey)
try {
  const result = await new TopicCreateTransaction().setTopicMemo('Faultline delivery receipts v1')
    .setSubmitKey(operatorKey.publicKey).execute(client)
  const receipt = await result.getReceipt(client)
  if (!receipt.topicId) throw new Error('Topic creation succeeded without topic ID')
  console.log(JSON.stringify({ topicId: receipt.topicId.toString(), transactionId: result.transactionId.toString() }))
} finally { client.close() }
