---
name: sealedai-stack
description: Verified facts about the SealedAI hackathon stack (0G Chain, Storage, Private Computer Router, Compute SDK, ERC-8004, ERC-7857, ERC-8183, dstack/0G-TAPP attestation, Arkiv). Use before writing or reviewing any code that touches these, and before claiming what any of them supports.
---

# SealedAI stack facts (researched 2026-11-06 from official docs)

For 0G SDK usage, first read the matching official skill in `./.0g-skills/skills/` (agentic-id, chain, compute, cross-layer, private-computer, storage). This file adds verified facts and traps. If something here conflicts with live behaviour, trust live behaviour and update this file.

## 0G Chain (Galileo testnet)
- Chain ID 16602, RPC `https://evmrpc-testnet.0g.ai`, explorer `https://chainscan-galileo.0g.ai`, faucet `https://faucet.0g.ai`.
- Solidity: compile with `evmVersion: "cancun"`. "invalid opcode" means wrong EVM version.
- Verify contracts via `https://chainscan-galileo.0g.ai/open/api`.

## 0G Storage
- Package `@0gfoundation/0g-storage-ts-sdk` (NOT `@0glabs/...`). Needs `ethers@6.13.1` exactly. Do not bump ethers.
- Testnet indexer `https://indexer-storage-testnet-turbo.0g.ai`. Explorer `https://storagescan-galileo.0g.ai`.
- Built-in client-side encryption: upload `{ encryption: { type: 'aes256', key } }` or `{ type: 'ecies', recipientPubKey }`; download `indexer.downloadToBlob(root, { proof: true, decryption: { symmetricKey } | { privateKey } })`.
- TRAP: a wrong key does NOT throw; it returns ciphertext. The `aes256` mode is AES-256-CTR with NO authentication
  (`lib.esm/common/encryption.js`), so tampering is undetectable. Project rule: never use SDK encryption; upload our
  AES-GCM envelope (docs/PROTOCOL.md §3).
- `indexer.download()` (to file) does not decrypt and does not work in browsers.

## 0G Private Computer (Router)
- OpenAI-compatible. Mainnet `https://router-api.0g.ai/v1`; testnet `https://router-api-testnet.integratenetwork.work/v1` (separate keys and balances). Key `sk-...` from pc.0g.ai, in `.env` as `ZG_API_KEY`.
- Trust mode header `X-0G-Provider-Trust-Mode: private|verified` (omit for standard). `private` = TeeML only; 503 `no_provider_for_trust_mode` if none.
- `GET /v1/models` needs no auth; TEE models have `tee_attested: true`, `verifiability: "TeeML"`.
- As of 2026-11-06 the ONLY chat model with TeeML is `0gm-1.0-35b-a3b` (TDX).
- TRAP: 0gm thinks by default and burns `max_tokens` on thinking, giving an empty reply. Send `chat_template_kwargs: { enable_thinking: false }`.
- Every response has `X-Request-ID` header and `x_0g_trace { request_id, provider, billing }` in the body. Log and show these (judges require request IDs).
- Optional `verify_tee: true` makes the Router verify the provider TEE signature.
- The Router is inference only. Fine-tuning is the Direct SDK flow only.
- Private mode gateway sees prompts in plaintext (0G calls it "tier 2.5"). Never send raw buyer data or weights to the LLM; aggregates only.

## 0G Compute Direct SDK
- Package `@0gfoundation/0g-compute-ts-sdk` (NOT `0g-serving-broker`). `createZGComputeNetworkBroker(wallet)`.
- Ledger: `broker.ledger.depositFund(n)` (creates ledger, min 3 0G), `transferFund(provider, 'inference'|'fine-tuning', amountWei)`. There is no `addLedger`.
- Fine-tuning = LoRA on provider-configured models (Qwen2.5-0.5B, Qwen3-32B, or provider custom). Users cannot upload their own base model or code.

## Agent identity and standards
- ERC-8004 (Draft) on Galileo: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`. NO Validation Registry deployed on 0G.
  - `register(agentURI)`, `giveFeedback(agentId, int128 value, uint8 valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)` (owner cannot rate own agent), `getSummary(agentId, clientAddresses[], tag1, tag2)` (clientAddresses must be non-empty).
- ERC-7857 (Final): 0G's AgenticID contract on Galileo implements it for AgentDNA agents (see below). The older
  `0g-agent-nft` repo is not deployed. Not used by this project's MVP (PLAN D8).
- ERC-8183 (Draft) escrow shape: Open -> Funded -> Submitted -> Completed/Rejected/Expired; refunds via `claimRefund` after `expiredAt` (no `expire()`).

## 0G AgentDNA / Agentic ID (verified 2026-11-06; NOT our worker: owner chat channel, see PLAN §5. Reference only)
- Package `@0gfoundation/0g-agentdna` 0.4.0 (installed via the `0g-agenticid-sdk` shim). viem-based. CLI `0g-agentdna`.
- Testnet attestor `https://agentdna-testnet.0g.ai`; `AgentDNA.fromAttestor(url, { account })` fills every address
  from `GET /config`. Live config 2026-11-06: AgenticID `0x34493302287308f565cf3409daadedf4c8895648`,
  CloneGate `0xaccdcc5a6569ab25aa144cccfddb882feadabb89`, StandardCloneAuthorizer
  `0x013a65aea5be739a4bfbd2b368863aba6fb98e6e`, VerifiedFeedbackRegistry `0xc0c902666078774435429d1fdeb5b1b17d95d583`,
  frameworks openclaw / hermes / prime-agent / 0g-harness, `secret_env_scheme: agent-seal-ecies-v1`. Re-read
  `/config` rather than hard-coding.
- Agents = ERC-7857 tokens with encrypted iData; run in TDX "sealed" containers; the owner never holds the agent key.
  `/api/*` services the agent registers (`POST $SEAL_SIGN_SOCK/services`) return `X-Agent-Proof` serve-proofs;
  owner chat routes are NOT signed. Proofs expire after about 1 h and are bound to one submitter.
- Deploy without `sandbox`, then `start(sealId, { apiKey })`, so the model key is sealed (not shown in the wallet prompt).
- Cost: 0.001 0G/CPU/min + 0.0005 0G/GB/min; default 2C/4GB = 0.004 0G/min. `doctor` wants sandbox balance ≥ 0.1 0G.
- Clone-for-sale: `setCloneAuthorizer(agentId, authorizer)`; `ICloneAuthorizer.canClone(source, targetOwner, caller,
  data)` is a view; StandardCloneAuthorizer = seller `grant(agentId, buyer)`.
- TRAP: the owner can chat with the agent privately, so anything the agent saw, the owner can try to extract.
- Source: `https://github.com/0gfoundation/0g-agentic-id` (`sealed/TRUST_MODEL.md` is the must-read).

## ERC-8183 reference contracts
- `https://github.com/erc-8183/base-contracts` (MIT, Foundry, solc 0.8.28, cancun). ERC-20 only (`MockUSDC` included).
  UUPS + admin roles (pause, emergencyWithdraw while paused): renounce after setup.
- `createJob(provider, evaluator, uint48 expiredAt, description, hook, providerAgentId)`; streaming payments via
  `settleClaim(jobId, cumulativeAmount, deliverable, optParams)` (client, while Funded); `claimRefund` after expiry
  (not hookable).

## 0G Private Sandbox, sealed mode (our worker route W1; `0gfoundation/0g-sandbox@ce187a4`)
- `POST /api/sandbox {snapshot, sealed:true, publicPorts:[8080,...], networkAllowList (<=10 CIDRs)}`. Sealed: SSH and
  toolbox blocked for life (403); the image digest is resolved and certified; a fresh secp256k1 container key is
  injected as `SANDBOX_SEAL_KEY`, plus `SANDBOX_SEAL_ATTESTATION` = v3 cert `{version, chain_id, registry_address,
  app_id, registered_at, seal_id, pubkey, image_hash, ts, signature}` (EIP-712 by the provider key). Caller env is
  restricted to a fixed key list.
- Snapshots (images) are registered by the PROVIDER only (`cmd/provider snapshot`), so our image needs 0G's help.
- The hosted broker `https://private-sandbox-testnet.0g.ai` returned 404 on documented paths on 2026-11-06.
  AgentDNA's provider `https://art-testnet.0g.ai/api/info` is live and `sealed_only: true`.
- The sandbox provider generates the container key (it's in the TCB for that hop).

## 0G-TAPP (worker route W2; `0gfoundation/0g-tapp@e0fc4c2`)
- Runs Docker Compose apps in TDX on Alibaba ECS or GCP TDX VMs. "Malicious deployer" model. `GetEvidence --nonce`
  returns `{quote, cc_eventlog, runtime_data}` with `report_data = sha512(runtime_data)`; runtime_data has
  `app_id, identities, key_commitments, nonce, signer, tls_public_key`. Hash the bytes as transmitted.
- Quote verification in JS: `@phala/dcap-qvl` 0.7.1.

## ERC-8183 constraints that shaped the design (@142e669)
- `setBudget`, `setPayoutReceiver`, `submit`: provider only. `evaluator != provider`, `client != provider`.
  `ERC8183WithAuthorization` (EIP-712 relayed variants) is 27,574 bytes, OVER the EIP-170 limit that 0G Galileo
  enforces: deploying it reverts. Use the base `ERC8183` (20,960 bytes). Local forge tests don't enforce size;
  check `forge build --sizes`. Our deployment: proxy 0x0E28A6Cb4A7B7De38Cc626E8E1E80A95cD0e070a, MockUSDC
  0xDfe37dF36Eff5Bed6F628ed8430EFaE8c8f7a7d7 (admin renounced). 0G gas estimation: use --gas-estimate-multiplier 150. `hook=0` is whitelisted at init. AccessControl is NOT enumerable.

## Attestation (older notes)
- dstack v1: `Attest(report_data <= 64 bytes)` returns TDX quote; `GetKey(domain, algorithm)`; SDK `@phala/dstack-sdk`. Verify with dcap-qvl / dstack-verifier.
- 0G-TAPP: `GetEvidence --nonce` returns `{quote, cc_eventlog, runtime_data}`, `report_data = sha512(runtime_data)`. GPU evidence signature is not checked by the repo yet.
- The dev server `sedrica-w` has NO TDX. Anything run there is unattested dev mode and must be labelled so.

## Key wrapping
- `eciesjs@0.5.0` (pinned): `encrypt(pubHex, data)`, `decrypt(privHex, data)`; 32-byte key wraps to 129 bytes.

## Things that do NOT exist (do not assume them)
- x402 does not support 0G. "Hydra" 3-key encryption is not a real protocol. comfy registration for self-hosted agents was closed per its README.
- No end-user API to run arbitrary containers in a 0G TEE (only provider-side via dstack / 0G-TAPP).

## Arkiv (if used)
- Testnet Rabdi: chain 7794095, RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`, faucet `https://hub.arkiv.network/faucet`. SDK `@arkiv-network/sdk` (viem). Max entity expiration ~182 days. RPC needs an access key: `.env` has `ARKIV_API_KEY` and `ARKIV_RPC_URL`; send the key as `X-API-KEY` header (or `Authorization: Bearer`, or appended to the path). Verified 2026-11-06: `eth_chainId` returns 7794095. MCP: `https://hub.arkiv.network/mcp` is currently only a web page saying "MCP setup is temporarily unavailable" (POST returns 405), so the MCP server can't connect for now.

## Full docs when needed
`https://docs.0g.ai/llms.txt`, `https://docs.0g.ai/ai-context`, `https://docs.arkiv.network`, `https://docs.arc.io/llms.txt`, `https://docs.x402.org/llms.txt`, EIPs at `https://eips.ethereum.org/EIPS/eip-<n>`.

## Repo rules
- Never print or commit `.env` values (PRIVATE_KEY, ZG_API_KEY). Run Node via `. ~/.nvm/nvm.sh` (Node 22, `.nvmrc`).
- Working examples: `examples/01..04` (storage, encrypted storage, private inference, ECIES wrap).
