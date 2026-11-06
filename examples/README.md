# 0G examples

Run from the project root (Node 22, `.env` with PRIVATE_KEY, RPC_URL, STORAGE_INDEXER, ZG_API_KEY, ZG_ROUTER_URL).

| # | Command | Shows |
|---|---|---|
| 01 | `npx tsx examples/01-storage-roundtrip.ts` | 0G Storage upload/download with Merkle proof. |
| 02 | `npx tsx examples/02-encrypted-storage.ts` | Why we don't use the SDK's `aes256` (wrong key returns ciphertext silently). |
| 03 | `npx tsx examples/03-router-private-inference.ts` | 0G Private Computer, private (TEE-only) tier, no fallback. |
| 04 | `npx tsx examples/04-ecies-key-wrap.ts` | ECIES key wrap to a worker key. |
| 05 | `npx tsx examples/05-arkiv-roundtrip.ts` | Arkiv write + creator-filtered query. |
| 07 | `npx tsx examples/07-envelope-0g-roundtrip.ts` | Our AES-GCM chunked envelope through real 0G Storage; truncation rejected. |
| 08 | `npx tsx examples/08-agent-live-recorded.ts` | Live agent on 0G Private Computer, recorded metrics. |
| 09 | `npx tsx examples/09-agent-live-real-training.ts` | Live agent driving real LoRA training (GPU, synthetic data). |
| 10 | `npx tsx examples/10-e2e-testnet.ts` | Full marketplace transaction on testnet (test-only verifier: no TEE here). |
| 11 | `npx tsx examples/11-arkiv-catalog.ts` | Arkiv listing + impostor listing hidden by verification. |
| 12 | `npx tsx examples/12-dev-worker.ts` | Local worker without TEE (every client refuses it). |

Evidence logs are in `docs/evidence/`.

## Results from a real run (0G Galileo testnet, chain 16602)

- 01: PASS. root `0xb1198cea023dd32d111a419f0a40de0e4bf3c19eb5412bdbfeccbbb7def03684`, tx `0xb82552a0359ab8cc14f23e402b530d7efca6d22155ca9bad29c3eb3613d85dd7`.
- 02: PASS. root `0xba01a6a8d4661e983a281ad5f39f877a3867ee63b399bddd1619bb60b62b0dca`, tx `0x4e6107d9125451b4052364c545447719f34f3f749c3ddcaf9842dbb0992b9d9d`. Wrong key returned 33 bytes, not the plaintext.
- 03: PASS in **private** mode (no fallback needed). Model `0gm-1.0-35b-a3b`, the only chatbot with `tee_attested: true` / `verifiability: "TeeML"` in `GET /models`. X-Request-ID `3ebf9adeaf275d3d, 867eaadf-8c09-4948-b4e2-1f6921baf89e`; `x_0g_trace` has `billing` (about 26 micro-USD), `provider` `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`, `request_id`.
- 04: PASS. 129-byte wrapped key for a 32-byte data key; a different keypair throws on unwrap.

## Gotchas

- Upload returns `{ txHash, rootHash }`; `indexer.download(root, path, true)` writes a file, `downloadToBlob` is simpler for in-memory use.
- Storage SDK also supports `{ type: ecies, recipientPubKey }` encryption, and `decryption: { privateKey }` on download.
- 0GM thinks by default; with `max_tokens: 200` the reply was empty until `chat_template_kwargs: { enable_thinking: false }` was set.
- `ethers` must stay at 6.13.1 (storage SDK).
