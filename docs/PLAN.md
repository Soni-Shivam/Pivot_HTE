> **Superseded for the hackathon by the Faultline spec** (`docs/superpowers/specs/2026-11-06-faultline-0g-architecture-design.md`, plan `docs/superpowers/plans/2026-11-07-faultline-build.md`); SealedAI rev 3 kept for reference.

# Project plan (working name SealedAI; the name is a placeholder)

Status: **REVISION 3, CONFIRMED by the user (T00 done, 2026-11-06): choices A–D as recommended in §2**
History: rev 1 (reuse-first) dropped the customization agent. Rev 2 restored it after the PR #1 review
(`docs/REVIEW-RESPONSE.md`) but kept a config-only asset whose prompts passed through the 0G Router gateway. Rev 3
applies the user's decisions: **everything confidential, no mock mode, a real seller model, actually trained
inside the enclave.**

Read in this order: this file → `docs/SECURITY.md` → `docs/PROTOCOL.md` → `docs/ARCHITECTURE.md` → `docs/TASKS.md`
→ the current phase plan in `docs/superpowers/plans/`. Facts come from official docs, pinned source or live calls
(pins in §9). Anything unconfirmed is marked **VERIFY** and owned by a task.

---

## 1. Product

**Long-term:** a general-purpose marketplace where a buyer privately evaluates and customizes a seller's
proprietary AI model on the buyer's private data. Neither the platform, the compute host, nor the other party can
read either side's asset.

**The promise:** *"Tell us what you need. Your data and their model meet only inside an attested enclave that you
both verified. An AI agent tunes the model to your goal, and you get a model you can use, measured on data it never
trained on."*

**Three separate roles:**

| Role | What it is | Sees |
|---|---|---|
| Seller's asset | A real model: architecture + weights (+ tokenizer and config) | Only the sealed worker |
| Customization agent | Planner LLM on 0G Private Computer; proposes training recipes via structured tools | Public model card, buyer's goal text, numeric data summary, **aggregate metrics only** (loss, accuracy, F1) |
| Sealed worker + policy gate | Our reviewed image in a GPU (or CPU) TEE: loads, trains, evaluates and serves the model; enforces every budget and output rule; signs receipts | Both assets, in enclave memory only |

### The MVP transaction
1. **Seller lists** a model: encrypted model bundle on 0G Storage, a signed Offer, a public listing on Arkiv.
2. **Buyer states a goal and budget**; the agent proposes a training plan from the public card, a numeric data
   summary and the recipe catalog. The buyer approves it.
3. **A sealed worker starts on TEE hardware.** Each party's own client verifies its evidence (CPU TDX quote + GPU
   attestation + certified image) and releases its key (2-of-2). No valid evidence → no release. There is no bypass.
4. **The worker runs the loop inside the enclave:** load the seller model → baseline on the validation split →
   the agent picks an approved training recipe → train on the train split → validation metrics → the agent decides
   the next step or finishes. Max 2 training runs. The best checkpoint is frozen and evaluated **once** on the final
   holdout.
5. **The buyer gets an encrypted report** (metrics, every agent decision with its 0G request ID, costs, failures,
   stop reason). The worker submits a signed receipt to escrow; the seller is paid a fixed fee.
6. **The buyer uses the customized model:** hosted inference inside the enclave for a license window (default, see
   choice C).

### Data and testing
Real confidentiality requires real TEE hardware, and **there is no mock mode in the product.** Without valid
evidence the clients refuse to release keys, full stop. During development, synthetic datasets and small open
models are used to exercise the ML code and the protocol on this server's RTX A5000. Those runs are *tests*, not a
product mode: they never produce a release, receipt or report that a client would accept (I12).

### Non-goals (hackathon)
Arbitrary seller code inside the training loop (unless choice B allows it), multi-node training, clone sales,
outcome-based pricing, pay-per-call, self-paying agents, our own backend server, other chains.

### Anti-goals
- Any asset byte or buyer row reaching a non-enclave service (including the 0G Router gateway).
- An "attested/confidential" label without verified CPU **and** GPU evidence.
- An LLM with authority (shell, network, files, signing, spending, key release).
- A demo fixture that redefines the marketplace: the manifest stays general (`task`, `format`, `executor`).

---

## 2. Final confirmation (T00): open choices

| # | Choice | Options | Recommendation |
|---|---|---|---|
| **A** | Hardware route and budget | **H1** 0G hosts our worker image on a GPU TEE provider (ask; no documented path) · **H2** GCP Confidential VM `a3-highgpu-1g` (1× H100 + Intel TDX) running 0G-TAPP (supported by the TAPP repo; spot available; quota request needed early) · **H3** Phala Cloud dstack on H100 TEE (third party, **VERIFY** pricing/access) · **H4** CPU-only TEE (0G sealed sandbox or TAPP on a TDX VM) for small models only | Ask 0G for H1 today **and** request GCP H100 confidential quota in parallel. Use H4 if the demo model is small enough to train on CPU (**VERIFY** timing). The user sets the budget before anything is spent. |
| **B** | Accepted model formats | **B1** standard formats only: Hugging Face `safetensors` + `config.json` for architectures on our allowlist, loaded by our reviewed code · **B2** also seller-supplied model code, sandboxed with no network, with scoring always in our code | **B1** for the hackathon (no seller code executes, so no exfiltration path through code). B2 later as a separate executor. |
| **C** | What the buyer gets | **C1** hosted inference inside the enclave for a license window (N calls / D hours) · **C2** the trained LoRA adapter file, encrypted to the buyer (usable only with the seller's base weights, so it still needs a license to run) | **C1**: neither party ever holds the combined model, and the usage is enforceable. C2 is an optional add-on the seller can allow in the Offer. |
| **D** | Model for development runs on the A5000 | e.g. `distilbert-base-uncased` (66M, text classification) · `Qwen2.5-0.5B` (causal LM, LoRA) | Both small and public: distilbert for the classification task adapter (the MVP), Qwen2.5-0.5B to prove LoRA on a causal LM. Synthetic datasets only. |

---

## 3. Components

### 3.1 Reused unchanged
| Need | Component | Pinned / source |
|---|---|---|
| TEE runtime (H2/H4) | **0G-TAPP**: Docker Compose apps in TDX, "malicious deployer" model, `GetEvidence --nonce` → `{quote, cc_eventlog, runtime_data}`, `report_data = sha512(runtime_data)`, app signer, attested TLS; optional GPU CC build where the evidence carries per-GPU reports bound to the same quote | `0gfoundation/0g-tapp@e0fc4c2` (`README.md`, `cvm/GPU.md`) |
| TEE runtime (H4 alt) | **0G sealed sandbox**: no SSH/exec, certified image digest, fresh container key, v3 certificate | `0gfoundation/0g-sandbox@ce187a4` |
| CPU quote verification | `@phala/dcap-qvl` 0.7.1 | npm |
| GPU attestation verification | NVIDIA device attestation: NRAS (remote) or NVIDIA's local verifier. **VERIFY** the exact package (T01). TAPP doesn't check the GPU report signature itself (`cvm/GPU.md`), so this is ours to add. | NVIDIA |
| ML stack (inside the worker) | PyTorch, `transformers`, `peft` (LoRA), `safetensors`, `datasets`. Exact versions pinned in the worker image lockfile. | PyPI |
| Escrow | **ERC-8183 reference**, base `ERC8183` (the authorization extension is over 0G's contract size limit) | `erc-8183/base-contracts@142e669`; Galileo proxy `0x0E28A6Cb4A7B7De38Cc626E8E1E80A95cD0e070a` |
| Agent inference | **0G Private Computer Router**, private tier only, key set to private-only routing; aggregates only. Option: call a TeeML provider directly via the Compute SDK to skip the gateway (**VERIFY** that its TLS ends in the enclave and that it counts for the track; needs a 3 0G ledger deposit). | live `/v1/models` |
| Blob storage | **0G Storage SDK**, Merkle-proofed upload/download, **SDK encryption off** (its `aes256` is unauthenticated AES-CTR) | 1.2.13 |
| Crypto | `@noble/ciphers` (AES-GCM), `@noble/hashes` (scrypt, sha256), `eciesjs` 0.5.0 (client and worker control plane; the Python ML plane does no crypto). | npm / PyPI |
| Public catalog | **Arkiv** `@arkiv-network/sdk` 1.0.1 | npm |

### 3.2 Ours
```
packages/protocol      EIP-712 types, manifest/offer/receipt schemas, envelope, canonical encoding
packages/planner       customization agent: tool schemas, policy gate, loop, prompts (TS, runs in the worker)
packages/client        keystore + recovery, evidence verification (CPU + GPU), key release, report decryption
packages/worker        worker control plane (TS): ECIES API, policy gate, escrow authorizations, receipts
worker/ml              ML plane (Python): model loader (allowlisted architectures), task adapters, LoRA
                       trainer, evaluator, inference server. Talks to the control plane over a local pipe only.
worker/image           Dockerfile + lockfiles → one image digest; compose file for TAPP
packages/integrations  0G Storage / Chain / Router and Arkiv adapters (ethers 6.13.1 confined to storage)
apps/cli, apps/web     reproducible end-to-end run first; UI second
contracts              Foundry: pinned ERC-8183 + deploy/renounce script + adversarial tests
```

### 3.3 Model bundle and task adapters (general manifest, MVP scope)
- **Bundle** (choice B1): `config.json`, `model.safetensors` (or sharded), tokenizer files, and `card.json` (public:
  name, task, architecture, parameter count, license, allowed recipes, input/output schema). Packed as a
  deterministic tar, sealed with the AES-GCM envelope, stored on 0G Storage.
- **Architecture allowlist** (loaded with `trust_remote_code=False`, no pickle; `safetensors` only):
  MVP `DistilBertForSequenceClassification`, `BertForSequenceClassification`, `Qwen2ForCausalLM`. Extending it is a
  reviewed code change.
- **Task adapters:** MVP **`text-classification`** (metrics: accuracy, macro-F1; outputs: labels only). Next:
  `causal-lm-sft` (metrics: val loss, exact-match on a structured target; outputs: text with a length cap and a
  disclosed leakage profile).
- **Splits:** a seeded hash split of the buyer dataset, 60/20/20 train/validation/holdout; the seed is committed
  (salted) in the manifest; the holdout is loaded only after `finish`.
- **Recipe catalog v1** (enumerated, never free-form):
  `lora {r ∈ {8,16}, alpha ∈ {16,32}, dropout ∈ {0.05,0.1}, targets ∈ card.allowedTargets}`,
  `head_only {}` (train only the classifier head),
  `optim {lr ∈ {5e-5, 1e-4, 2e-4}, epochs ∈ {1,2,3}, batch ∈ {8,16}, warmup ∈ {0, 0.06}}`,
  `class_weights {none, balanced}`, `max_len ∈ {128, 256}`.
  A proposal = one setting per group. Max 2 training runs plus the baseline.
- **Budgets** (in the manifest): max planner calls, max training runs (≤ 2), max GPU-seconds, max wall clock,
  max inference calls during the license.

### 3.4 Keys and data at rest
Per-object random 32-byte keys, AES-256-GCM, header-bound AAD (PROTOCOL §3); a local keystore under a random master
key; a scrypt passphrase recovery file; no wallet-signature-derived secrets. Key release = ECIES to the attested
worker key, carried in a signed `KeyRelease` bound to the manifest hash.

---

## 4. Flows (diagrams in ARCHITECTURE.md)
**A. List.** Seller packs and seals the bundle → 0G root → signs `Offer` (asset commitment, format, task,
architecture, recipe catalog hash, worker image digest, accepted TEE evidence policy, price, license, validity) →
Arkiv listing.
**B. Plan.** Buyer picks a listing; the client computes a numeric data summary (rows, label histogram, token-length
stats; no text). The agent (Router, private) proposes a plan; the buyer approves; `planHash` goes into the manifest.
**C. Worker + release.** The worker boots on TEE hardware → evidence (CPU quote + GPU reports + runtime_data with
the worker key) → each party's client verifies it independently plus a fresh nonce challenge → `createJob`, the
worker sets budget/payout from its own key (the buyer sends it gas), `fund` → seller releases the model key, buyer releases the dataset key and its Router
key. The worker requires both.
**D. Customize.** Baseline → ≤ 2 recipe trainings with validation feedback → freeze → holdout once. Everything stays
in enclave memory; checkpoints never leave unencrypted.
**E. Settle.** Encrypted report → worker-signed receipt and `submit` → seller `complete` → payout. Failure or no
submission → buyer refund after expiry.
**F. Use.** License window: encrypted, signed `/v1/infer` requests; outputs per the task adapter's policy. Choice C2
(if the Offer allows): the worker also exports the LoRA adapter encrypted to the buyer.

---

## 5. Runtime: gate G-RT (confidential or nothing)
Clients release keys only if **all** pass: a valid TDX quote under the TCB policy, debug off; `sha512(runtime_data)
== report_data`; our nonce echoed; the event log/compose shows the approved image digest; the worker key bound in
runtime_data and proven by signing our nonce; for GPU runs, each GPU attestation report verified against NVIDIA and
bound to the same evidence (`cvm/GPU.md` binding) with confidential-compute mode on. For H4 sealed sandbox: the v3
certificate + TappRegistry check instead of the quote (PROTOCOL §9).
**G-RT passes when** the seller's client independently accepts a worker the buyer created, and a wrong image, a
stale quote, a swapped key, an unverified GPU report and a replayed release each fail closed.
Rejected as the worker: AgentDNA agents (owner chat channel), 0G fine-tuning providers (they train only their own
base models; no way to load the seller's weights).

## 6. Payment (ERC-8183 reference, unchanged)
`client` = buyer, `provider` = worker (sends `setPayoutReceiver` / `setBudget` / `submit` from its enclave key; the
buyer funds its gas), `evaluator` = seller, `payoutReceiver` = seller, budget = `offer.price` in `offer.token`,
`description` = `"sealedai:v1:" ‖ manifestHash`, `hook` = 0. No claims are used. Admin roles are renounced and
tested. Fixed fee; GPU costs are the buyer's (they create and pay for the worker VM/sandbox). **VERIFY** in T00
whether the seller or the buyer pays for hardware in the demo.

## 7. Sponsors
| Track | How we qualify |
|---|---|
| 0G Private Computer ($5k, primary) | The customization agent runs on Private Computer in the main flow; every decision shows its request ID. The AI decides how a real model is trained, so removing it changes the product. Risk: "consumer app": pitched to individuals and small teams adapting AI to their own data. |
| Arkiv ($4k) | Listings and buyer-reported scores read on the browse page; required `/arkiv/*.md` files |
| EF CROPS ($3.5k) | Independence from us (no backend; client from the repo; refunds need only RPC + contract), with a dependency/failure matrix |
**VERIFY (T11):** partner-prize limit; pre-event history vs Arkiv's "from scratch" rule.

## 8. "What breaks without 0G"
No attested runtime registry (TappRegistry) or TAPP stack to hold both assets, no private TEE inference for the
agent that plans the training, no verifiable storage for the encrypted model and data, no escrow chain.

## 9. Pinned revisions
ERC-8183 `142e669` · 0G-TAPP `e0fc4c2` · 0G sandbox `ce187a4` · 0G agent skills `04b5a42` · AgentDNA `e8cd7a4`
(reference only) · ethers exactly 6.13.1 · storage SDK 1.2.13 · Arkiv SDK 1.0.1 · dcap-qvl 0.7.1.

## 10. Decisions
| # | Decision | Status |
|---|---|---|
| D1 | Seller asset = a real model (architecture + weights), general manifest; MVP format B1, task `text-classification` | **Rev 3, confirmed** (reverses rev 2's config-only asset) |
| D2 | Customization = real training (LoRA / head-only) from an enumerated catalog, ≤ 2 runs, agent behind a policy gate | **Rev 3, confirmed** |
| D3 | The worker runs only on verified TEE hardware; no mock mode; dev tests use synthetic data and never produce acceptable artifacts | **Rev 3, confirmed** |
| D4 | Escrow: ERC-8183 reference; worker = provider, seller = evaluator; fixed fee; admin renounced | Kept |
| D5 | No backend of ours | Kept |
| D6 | Arkiv: public data only; scores "buyer-reported" | Kept |
| D7 | Our AES-GCM envelope; random keys + recovery file | Kept |
| D8 | Clone sales, AgentDNA assets, ERC-8004 feedback deferred | Kept |
| D9 | Customization agent required | Kept |
| D10 | Router sees aggregates only; all model and data compute in our enclave | **Rev 3** (fixes the gateway flaw) |
| D11 | Docs set: PLAN, SECURITY, PROTOCOL, ARCHITECTURE, TASKS, per-phase plans | Kept |

## 11. Open questions (owner task)
1. 0G: can a provider host our worker image on a GPU TEE (H1)? Is a hosted TAPP node available? [T01]
2. 0G: the TappRegistry getter for provider and app-signer status. [T01]
3. GCP: H100 confidential VM quota in a listed zone; the reported "experiment flag" error. [T01]
4. NVIDIA GPU attestation verifier to use (NRAS vs local) and how it binds to TAPP evidence. [T01]
5. CPU-TEE training time for distilbert on ~5k rows (decides whether H4 is viable). [T01]
6. Direct TeeML provider calls: does TLS end in the enclave; does it count for the PC track? [T01]
7. ETHGlobal: partner-prize limit; pre-event history. [T11]

## Sources
0G-TAPP `README.md` and `cvm/GPU.md` (GCP `a3-highgpu-1g` with TDX; GPU report signature not checked in the repo);
0G sandbox `docs/API_REFERENCE.md`, `docs/CLI.md`; 0G Router privacy doc; 0G fine-tuning skill
(`.0g-skills/skills/compute/fine-tuning/SKILL.md`); ERC-8183 at the pin; storage SDK `encryption.js`; ETHGlobal
prize pages; PR #1 review; the user's rev-3 decisions (relayed 2026-11-06). GCP and Phala GPU-TEE availability
come from research relayed by a side session and are **VERIFY** until T01 confirms them.
