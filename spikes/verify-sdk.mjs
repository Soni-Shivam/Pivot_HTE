import { ethers } from 'ethers'
import { createZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk'
const [provider, chatId] = process.argv.slice(2)
const wallet = ethers.Wallet.createRandom().connect(new ethers.JsonRpcProvider('https://evmrpc.0g.ai'))
const broker = await createZGComputeNetworkBroker(wallet)
const t = Date.now()
const ok = await broker.inference.processResponse(provider, chatId)
console.log('processResponse ->', ok, 'in', Date.now() - t, 'ms')
