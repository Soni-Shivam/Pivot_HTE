/** One-time testnet fixture: a fungible FLTTEST token, minted to payer and auto-associated to merchant. */
import 'dotenv/config'
import { Client, PrivateKey, TokenCreateTransaction, TokenType, TransferTransaction } from '@hiero-ledger/sdk'

const payer = process.env.HEDERA_PAYER_ACCOUNT_ID
const merchant = process.env.HEDERA_MERCHANT_ACCOUNT_ID
const key = process.env.HEDERA_PAYER_PRIVATE_KEY?.replace(/^0x/, '')
if (!payer || !merchant || !key || !/^[0-9a-fA-F]{64}$/.test(key) || payer === merchant)
  throw new Error('Set payer, merchant, and payer ECDSA key')
if (process.env.HEDERA_NETWORK !== 'hedera:testnet') throw new Error('Fixture creation is testnet only')
const client = Client.forTestnet().setOperator(payer, PrivateKey.fromStringECDSA(key))
try {
  const created = await new TokenCreateTransaction().setTokenName('Faultline Test Credit')
    .setTokenSymbol('FLTTEST').setTokenType(TokenType.FungibleCommon).setDecimals(0)
    .setInitialSupply(100).setTreasuryAccountId(payer).execute(client)
  const receipt = await created.getReceipt(client)
  const tokenId = receipt.tokenId
  if (!tokenId) throw new Error('Token creation returned no token ID')
  const funded = await new TransferTransaction().addTokenTransfer(tokenId, payer, -1)
    .addTokenTransfer(tokenId, merchant, 1).execute(client)
  await funded.getReceipt(client)
  console.log(JSON.stringify({ tokenId: tokenId.toString(), symbol: 'FLTTEST', payer: 'associated by treasury',
    merchant: 'auto-associated by funding transfer', creationTx: created.transactionId.toString(),
    fundingTx: funded.transactionId.toString() }, null, 2))
} finally { client.close() }
