# SealedAI (working name)

> **Faultline build in progress** (branch `build/faultline`): see the spec `docs/superpowers/specs/2026-11-06-faultline-0g-architecture-design.md`.

**Customize someone else's AI model on your private data, without either of you seeing the other's asset.**

A seller lists a proprietary model (weights stay encrypted). A buyer states a goal. An AI agent on **0G Private
Computer** plans real LoRA training of the seller's model on the buyer's data, reads validation results and adapts.
The model and the data meet only inside a sealed worker that **each party's own client verifies** before releasing
its key (2-of-2). The buyer gets a customized model, scored once on held-out data the agent never saw, and the seller
is paid through an ERC-8183 escrow on 0G Chain. There is no server of ours anywhere in the flow.

> **Honest status.** Everything below runs on 0G testnet today, except one thing: this development machine has no
> TEE hardware, so the production client **refuses** to release keys to our worker (as designed). The end-to-end run
> uses a clearly labelled test-only verifier and synthetic data. Running the same worker image on Intel TDX (+ H100
> confidential computing) via 0G-TAPP is the remaining step (T02). See [Limitations](#limitations).

## What happens in one transaction

1. **Seller lists** a model: deterministic tar → AES-256-GCM in 64 MiB chunks → 0G Storage; signs an EIP-712 Offer
   that pins the price, license and the *only* worker image allowed to see the weights; publishes a listing on **Arkiv**.
2. **Buyer browses** Arkiv. Each listing is shown only if its Arkiv creator is the seller and the signed offer
   fetched from 0G Storage verifies (impostor listings are hidden).
3. **Agent plans** from numbers only: the buyer's browser computes label counts and length percentiles; the dataset
   never leaves the device. The agent's reply passes the same policy gate the worker enforces.
4. **Worker check + escrow.** The buyer verifies the worker (fresh nonce, key-possession challenge, Intel DCAP quote,
   RTMR3 event-log replay, image digest, GPU report binding), creates the ERC-8183 job, the worker quotes on chain
   (budget, payout → seller), the buyer funds.
5. **2-of-2 key release.** The seller re-verifies the worker and the exact funded terms itself, then wraps its key;
   the buyer wraps its dataset key, goal and Router key. Either one withholding stops everything.
6. **Customization inside the worker:** baseline → the agent picks enumerated LoRA / head-only recipes → real
   training → validation metrics → next decision → finish → holdout evaluated exactly once.
7. **Settlement:** sealed report for the buyer, EIP-712 receipt signed by the worker key, `submit` → seller
   `complete` → payout. Then label-only inference from the customized model for the license window.

## Evidence (0G Galileo testnet, synthetic data)

| What | ID |
|---|---|
| ERC-8183 escrow proxy (admin roles renounced) | `0x0E28A6Cb4A7B7De38Cc626E8E1E80A95cD0e070a` · test USDC `0xDfe37dF36Eff5Bed6F628ed8430EFaE8c8f7a7d7` |
| Seller model (sealed) / signed offer on 0G Storage | asset `0xf363c657…6ff7` · offer `0x326aef97…aa6e` |
| Escrow job 1: create / fund / worker submit / seller complete | `0x3437c178…9ad3` / `0xd9f0337e…8741` / `0x0e3a928d…9633` / `0xee18a058…edbc` |
| Agent requests on 0G Private Computer (private tier) | `256901f3c3557d25`, `1aca622631c372d7`, `31486e835454782b`, … |
| Customization result | val macro-F1 0.788 → 0.947 (LoRA, balanced weights) · holdout 0.964 |
| Sealed report root | `0x9522ed9db27a5c15c405b20c475fe3a28738c669578ab5f53cf7988791d2fde3` |
| Arkiv listing (shown) / impostor (hidden) | `0xe7e6e3a5…a7e3` / `0x22d6d29b…7af6` |

Full logs with every hash: [`docs/evidence/`](docs/evidence/) (`10-e2e-testnet.log`, `11-arkiv-catalog.log`, …).

## Run it

Requirements: Node 22, Python 3.11+ with [uv](https://docs.astral.sh/uv/), an NVIDIA GPU for training, Foundry for
contracts. Copy `.env.example` to `.env` and fill in your own keys.

```bash
npm ci && ./scripts/setup.sh
```
```bash
(cd worker/ml && uv sync)
```
```bash
npm test && (cd worker/ml && uv run pytest -q) && (cd contracts && forge test)
```

Web app (talks only to public 0G and Arkiv endpoints; open it at **localhost**, which the 0G Router allows):

```bash
npm run web:build && npm run web:serve
```

Full testnet transaction (spends testnet 0G; synthetic data; test-only verifier, see above):

```bash
npx tsx examples/10-e2e-testnet.ts
```

Arkiv catalog with spoof check: `npx tsx examples/11-arkiv-catalog.ts`. Live agent + real training without the
chain: `npx tsx examples/09-agent-live-real-training.ts`. Demo seller model: `worker/ml/tools/make_seller_bundle.py`.

## Arkiv

- Writer wallets: seller `0x8dac3a1fd3D7796254b84Ad70750430f67871069`; impostor test `0x76cE631D4d750124DBDA74774840F25D3A70Cd5E`.
- Query: `select from sealedai.listing/v1 where category = "support-triage"` (paged, 100 per page), then keep rows whose
  `$creator == seller` and whose offer (0G root `offerRoot`) verifies — `packages/client/src/catalog.ts`.
- Judging files: [`arkiv/`](arkiv/).

## CROPS

- **C (censorship resistance).** We run nothing the user depends on: the app is static files built from this repo,
  calling 0G RPC, the 0G Storage indexer, the Arkiv RPC and the 0G Router directly; every endpoint is editable in the
  app. Refunds need only an RPC and the escrow contract, whose admin roles are renounced (no pause, no withdrawal,
  no upgrade). What still depends on others: 0G (chain, storage, Router), the TEE host, and Arkiv.
- **O (open source).** MIT. Build and run from the repo alone (commands above); dependencies are pinned exactly.
- **P (privacy).** RPC/indexer/Arkiv operators see wallet addresses and public data; storage holds only AES-GCM
  ciphertext; the 0G Router sees the agent's prompts, which contain the public model card, the buyer's goal text and
  aggregate numbers only (never rows or weights); nothing else leaves the user's device. No analytics, no trackers.
- **S (security).** Keys are generated and kept on the user's device (passphrase-protected recovery file); keys reach
  only a worker the user's own client verified; the LLM has no authority (enumerated tools, deterministic policy gate,
  budgets in code). Trust assumptions: Intel TDX / NVIDIA CC, the measured worker image, 0G-TAPP, and the 0G Router for
  aggregate prompts. Full model: [`docs/SECURITY.md`](docs/SECURITY.md).

## Limitations

- **No TEE on our dev machine:** the production verifier refuses our worker; the testnet run uses a test-only verifier.
  Remaining for a confidential run: 0G-TAPP evidence provider in the worker, NVIDIA GPU report verification, and TDX
  hardware (0G-hosted, or GCP `a3-highgpu-1g`). Tracked as T02/T14 in [`docs/TASKS.md`](docs/TASKS.md).
- The ML process's network isolation here is an in-process guard (Ubuntu's AppArmor blocks unprivileged network
  namespaces); in the TEE image it runs without network.
- MVP scope: text classification, allowlisted architectures (BERT, DistilBERT), ≤ 2 training runs, label-only outputs.
- The manifest predicts the next escrow job id; a concurrent `createJob` makes the buyer retry.
- The base `ERC8183` is used: its `WithAuthorization` extension exceeds 0G's 24,576-byte contract size limit.

## Docs

[`PLAN`](docs/PLAN.md) · [`SECURITY`](docs/SECURITY.md) · [`PROTOCOL`](docs/PROTOCOL.md) ·
[`ARCHITECTURE`](docs/ARCHITECTURE.md) (16 diagrams) · [`TASKS`](docs/TASKS.md) · [`REVIEW-RESPONSE`](docs/REVIEW-RESPONSE.md)

## AI use

Planned and built with Claude Code (Anthropic) agents, reviewed by the team; a teammate's review used Codex. All
runtime AI in the product is the 0G Private Computer agent described above.

MIT licensed — see [LICENSE](LICENSE).
