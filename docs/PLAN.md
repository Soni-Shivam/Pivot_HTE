# Project plan (working name SealedAI; the name is a placeholder)

Status: **REVISION 2, awaiting scope approval (T00)** · 2026-11-06
Revision 1 dropped the customization agent and the two-party key release. The PR #1 review (R01–R16, T00–T12)
asked for both back. This revision restores them. How each review point is handled: `docs/REVIEW-RESPONSE.md`.

Read in this order: this file → `docs/SECURITY.md` (threat model, allowed claims) → `docs/PROTOCOL.md` (exact
schemas) → `docs/ARCHITECTURE.md` (diagrams) → `docs/TASKS.md` (tracker) → the current phase plan in
`docs/superpowers/plans/`.

Every external fact below was read from official docs, pinned source code or a live call on 2026-11-06. Pinned
revisions are in §9. Anything unconfirmed is marked **VERIFY** and owned by a task.

---

## 1. Product

**Long-term:** a general-purpose marketplace where people privately evaluate and adapt proprietary AI (models,
prompt pipelines, agents) to their own needs. Neither the platform, nor the host, nor the other party can read
either side's asset.

**The promise:** *"Tell us what you need. We test and adapt a seller's proprietary AI against your private data in a
bounded, verifiable workflow, while each party controls access to its own asset."*

**Three separate roles** (the review's central point):

| Role | What it is | In the MVP |
|---|---|---|
| Seller's asset | The thing being licensed | An `llm-classifier/v1` configuration: prompt templates, label guidelines, optional seller examples. Pure data, no code. |
| Customization agent | Plans how to adapt the asset to the buyer's goal | A planner LLM on 0G Private Computer that calls structured tools. Deterministic policy validates every action. |
| Sealed worker + policy gates | Holds both assets, runs only authorized operations, enforces budgets and output rules, signs receipts | Our reviewed worker image in a sealed TEE container that both parties verify before releasing their keys |

### The MVP transaction (must work end to end)
1. **Seller lists** an asset: encrypted bundle on 0G Storage, a signed Offer, and a public listing on Arkiv.
2. **Buyer states a goal and budget.** The planner proposes a plan from the public asset card, a local summary of
   the buyer's data and the recipe catalog. The buyer approves it.
3. **A sealed worker is created.** Buyer and seller each verify its evidence (certified image digest, fresh key,
   approved manifest), then each releases its own key to it (2-of-2).
4. **The worker runs the loop:** baseline on validation → planner picks an approved recipe → experiment →
   validation metrics → planner decides the next step or finishes. Max 2 experiments. The best config is frozen and
   evaluated **once** on the final holdout.
5. **The buyer gets an encrypted report** (metrics, every planner decision with its 0G request ID, costs, failures,
   stop reason). The worker submits a signed receipt to escrow and the seller is paid a fixed fee.
6. **The buyer uses the result:** the customized classifier is served by the same sealed worker for a license window
   (N calls / D hours), with requests and responses encrypted end to end.

### Non-goals (hackathon)
Weight training, multiple asset types, arbitrary or generated code, clone sales, outcome-based pricing, pay-per-call
streaming payments, self-paying agents, our own backend server, x402 or other chains.

### Anti-goals (a failure even if it "works")
- Calling anything "attested", "confidential" or "private" without the evidence `docs/SECURITY.md` requires.
- An LLM that can run shell commands, reach arbitrary hosts, spend money or approve key release.
- Seller-controlled code or an owner chat channel touching buyer data.
- A demo fixture that silently redefines the marketplace (the manifest stays general; the fixture is one executor).

---

## 2. Scope decision for approval (T00): what we promise

Each guarantee is classified separately, as the review asked. "Confidential mode" exists only when gate **G-RT**
(a real attested runtime) passes. Until then everything runs in **MOCK mode**, labelled as such everywhere.

| Property | Confidential mode (after G-RT) | MOCK mode (always available) |
|---|---|---|
| At rest | AES-256-GCM per object, keys held only by their owner (§3.4) | Same |
| In transit | App-layer ECIES to the attested worker key, so proxies see ciphertext | Same code, but the worker key isn't attested |
| Runtime | Sealed TEE worker: certified image, no SSH/exec, fresh per-job key, 2-of-2 release | Local container on a dev machine. **Not confidential. Synthetic data only.** |
| Third party seeing plaintext | 0G Router gateway (in memory, zero retention per 0G docs) + a TeeML provider see template + buyer text for each inference call. Explicitly trusted and disclosed. | Same |
| Output integrity | Receipt signed by the attested worker key, bound to the manifest | Signed by the mock key; the verifier labels it MOCK |
| Answer quality | Objective metrics (accuracy, macro-F1) on a held-out split. The LLM's commentary is advisory only. | Same |
| Delivery fairness | Fixed fee in ERC-8183 escrow; paid only after the worker submits; refundable on failure or expiry | Same contracts on testnet |
| Availability | Depends on 0G Chain, Storage, Router, the sandbox provider and Arkiv; static client, no backend of ours | Same |

**Decisions needed from the user (T00):**
1. Approve this scope: the MVP asset type `llm-classifier/v1`, configuration customization (not weight training),
   fixed fee, and MOCK mode until G-RT passes.
2. Runtime route for G-RT, in order of preference (details in §5):
   **W1** ask 0G to register our worker image as a sealed-sandbox snapshot;
   **W2** run it under 0G-TAPP on a TDX VM (needs a GCP or Alibaba account and budget);
   **W4** ship MOCK only and say so.

---

## 3. Components

### 3.1 Reused unchanged
| Need | Component | Pinned |
|---|---|---|
| Sealed TEE worker (W1) | **0G Private Sandbox, sealed mode**: no SSH or toolbox for the container's lifetime; image digest certified; fresh secp256k1 container key; provider-signed v3 certificate `{chain_id, registry_address, app_id, registered_at, seal_id, pubkey, image_hash, ts, signature}`; egress `networkAllowList` (≤ 10 CIDRs) | `0gfoundation/0g-sandbox@ce187a4` |
| Sealed TEE worker (W2) | **0G-TAPP** ("malicious deployer" model): `GetEvidence --nonce` → `{quote, cc_eventlog, runtime_data}`, `report_data = sha512(runtime_data)`, app signer in evidence, attested TLS | `0gfoundation/0g-tapp@e0fc4c2` |
| TDX quote verification (W2) | `@phala/dcap-qvl` 0.7.1 | npm |
| Escrow | **ERC-8183 reference** incl. `ERC8183WithAuthorization` (EIP-712 signed actions with nonce and deadline) | `erc-8183/base-contracts@142e669` |
| Test token | `MockUSDC` from the same repo | same |
| Planner + inference | **0G Private Computer Router**, `X-0G-Provider-Trust-Mode: private`, `0gm-1.0-35b-a3b`; the API key itself set to private-only routing (per the 0G privacy doc) | live `/v1/models` |
| Encrypted blobs | **0G Storage SDK**, upload/download with Merkle proof. We do **not** use its `aes256` mode (AES-CTR, unauthenticated); we upload our own AES-GCM ciphertext. | `@0gfoundation/0g-storage-ts-sdk` 1.2.13 |
| Crypto primitives | `@noble/ciphers` (AES-GCM), `@noble/hashes` (scrypt, sha256), `eciesjs` 0.5.0 (secp256k1 ECIES) | npm, exact versions |
| Public catalog | **Arkiv** `@arkiv-network/sdk` 1.0.1 (Rabdi, chain 7794095) | npm |

### 3.2 Ours (proposed boundaries, from the review)
```
packages/protocol      EIP-712 types, manifest/offer/receipt schemas, canonical encoding, invariants
packages/planner       customization agent: tool schemas, policy, budget/stop rules, prompt templates
packages/client        local keys + vault, evidence verification, key release, report decryption
packages/worker        the sealed worker: HTTP API, policy gates, executor adapters, receipts
packages/integrations  0G Storage / Chain / Router and Arkiv adapters (ethers 6.13.1 confined to storage)
apps/cli               reproducible end-to-end transaction (built before the UI)
apps/web               goal → plan → approve → experiments timeline → report → use
contracts              Foundry: pinned ERC-8183 + deploy/renounce script + adversarial tests
```

### 3.3 Executor `llm-classifier/v1` (the first, and only MVP, executor)
- **Seller asset bundle** (JSON): `templates[]` (≤ 3 prompt variants with `{guidelines}`, `{examples}`, `{input}`
  slots), `guidelines` (text), `sellerExamples[]` (optional), `labelSet[]`, `defaultConfig`.
- **Buyer dataset** (JSONL): `{text, label}` rows; labels ⊆ `labelSet`.
- **Splits:** a seeded hash split, 60/20/20 train/validation/holdout. The seed is committed in the manifest under a
  random salt. Holdout rows are loaded only after `finish`.
- **Recipe catalog v1** (reviewed; params are enumerated, never free-form):
  `fewshot {k ∈ {0,2,4,8}, selection ∈ {random, stratified}}` (examples drawn from the buyer's **train** split),
  `template {variant ∈ seller template ids}`, `decode {temperature ∈ {0, 0.3}}`,
  `labelhints {on, off}` (adds the buyer's public label descriptions).
- **Metrics:** accuracy and macro-F1, computed deterministically by the worker. Per-class metrics are suppressed
  below 5 samples. A model output outside `labelSet` counts as wrong and is reported.
- **Output policy:** inference responses are labels from `labelSet` only. Free text never leaves the worker. That
  bounds what a hostile input can extract per call to log2(|labelSet|) bits (disclosed).

### 3.4 Keys and data at rest
- Each object (asset bundle, dataset, report) gets a fresh random 32-byte key and AES-256-GCM with a 12-byte random
  nonce. AAD = the canonical object header `{schema, objectType, objectId, version, plaintextSha256}`.
- **Local keystore:** a random master key encrypts the per-object keys. Recovery = an exported file encrypted under
  scrypt(passphrase) with AES-GCM. A fresh device recovers from file + passphrase, with nothing from us. No
  wallet-signature-derived secrets (review R08).
- Key release = ECIES (`eciesjs`) of the object key to the worker's attested pubkey, carried in a signed
  `KeyRelease` bound to the manifest hash (§`PROTOCOL.md`).

---

## 4. Flows (diagrams in ARCHITECTURE.md)

**A. List.** Seller encrypts the bundle → 0G Storage root → signs `Offer` (asset commitment, executor, recipe catalog
hash, worker image digest, price, token, license terms, validity) → Arkiv `listing` entity with the offer hash.

**B. Plan.** Buyer selects a listing (Arkiv query; owner re-validated on chain). The client computes a **local data
summary** (row count, label histogram, mean length; no text). The planner (Router, private) gets the summary, public
asset card and catalog, and returns a plan. The buyer approves it; the plan's hash goes into the manifest.

**C. Worker + release.** Buyer creates the sealed worker → gets the certificate/evidence → challenges the worker to
sign a fresh nonce → builds and signs `JobManifest` → `createJob(provider=worker, evaluator=seller, …)` → relays
worker-signed `setBudget(offer.price)` and `setPayoutReceiver(seller)` → `fund(expectedToken, expectedBudget)`.
Seller's client independently verifies evidence + manifest + on-chain job terms, then releases the asset key. Buyer
releases the dataset key and its Router key. The worker starts only when both releases are valid.

**D. Customize.** The worker runs the bounded loop (§3.3, ARCHITECTURE §7). Every planner call goes through the
policy gate; every decision and request ID is appended to a hash-chained timeline.

**E. Settle.** Worker uploads the encrypted report → signs `WorkerReceipt` and `SubmitAuthorization(deliverable =
receipt commitment)` → buyer (or anyone) relays `submit` → seller calls `complete` (or relays a signed completion) →
payout to seller. No submission by expiry → buyer `claimRefund`. Submitted but seller never completes → refund after
expiry + 1 h grace (the reference contract's rule; disclosed to sellers).

**F. Use.** For the license window, the buyer sends ECIES-encrypted, signed `/infer` requests; the worker answers
with labels encrypted to the buyer, counting calls in memory. If the worker restarts, its keys are gone and the
license window ends (MVP limit, disclosed).

---

## 5. Runtime routes and gate G-RT

| Route | What it needs | Evidence a client checks | Status |
|---|---|---|---|
| **W1** 0G sealed sandbox | 0G registers our worker image as a snapshot on a provider that accepts sealed creates (snapshot registration is provider-only per `docs/CLI.md`) | v3 certificate signature recovers to the provider address; that provider is an active registered signer for its `app_id` in TappRegistry (**VERIFY getter**); `image_hash` == offer's `workerImageDigest`; fresh `ts`; worker signs our nonce with `pubkey` | Ask 0G on day 1. The public broker `private-sandbox-testnet.0g.ai` answered 404 on documented paths on 2026-11-06 (**VERIFY**). AgentDNA's provider `art-testnet.0g.ai` is `sealed_only` and dedicated to AgentDNA images. |
| **W2** 0G-TAPP on a TDX VM | GCP (TDX) or Alibaba ECS confidential VM + 0G-TAPP image; we deploy the worker compose | DCAP quote valid (dcap-qvl), TCB policy, `sha512(runtime_data) == report_data`, our nonce echoed, the event log shows our compose/image, the app signer signs the per-job worker key | Needs a cloud account and money (user decision) |
| **W4** MOCK | Docker on this server (not installed yet) | A mock certificate signed by a local mock-provider key. The verifier accepts it **only** in `mode=mock` and every surface shows MOCK. | Always |

**G-RT passes when:** a sealed worker created by the buyer client produces evidence that the *seller's* client
verifies independently. A wrong image digest, a stale certificate/quote, a substituted key or a replayed release each
fail closed. No SSH/exec is possible. Host or proxy capture shows ciphertext only.

Rejected for the worker: **AgentDNA agents.** The owner has a private chat channel and frameworks are LLM-driven,
not a fixed runner (review R01). AgentDNA stays a reference for its key chain and a roadmap option.

---

## 6. Payment design (ERC-8183 reference, unchanged)

| Field | Value | Why |
|---|---|---|
| `client` | buyer | pays |
| `provider` | the worker's address | only the provider can `setBudget` and `submit`, so those become worker-signed and manifest-checked |
| `evaluator` | seller | `evaluator != provider` is enforced; the seller can only complete (pay themselves) a job the worker submitted, or reject (refund the buyer) |
| `payoutReceiver` | seller, set by worker signature | money reaches the seller, not the worker key |
| `budget/token` | `offer.price` / `offer.token`, set by worker signature | the buyer funds with `expectedToken/expectedBudget` (front-running check in the contract) |
| `description` | `"sealedai:v1:" ‖ manifestHash` | no plaintext; the manifest hash covers salted commitments only (R07) |
| `hook` | `address(0)` | whitelisted at `initialize` |

The worker has no gas: its actions are EIP-712 authorizations (`setBudgetWithAuthorization`,
`setPayoutReceiverWithAuthorization`, `submitWithAuthorization`) that the buyer relays. Claims (`submitClaim`,
`settleClaim`) are **not used**, so `PendingClaimExists` can't block a refund. After deployment we renounce
`ADMIN_ROLE` and `DEFAULT_ADMIN_ROLE` (upgrade authority) and prove from the `RoleGranted`/`RoleRevoked` event history
that no holder remains (AccessControl is not enumerable).

---

## 7. Sponsors

| Track | How we qualify | Must show |
|---|---|---|
| **0G: Build with 0G Private Computer** ($5k, primary) | The customization agent and the classifier inference both run on Private Computer inside the main flow | Request IDs per decision and per call in the timeline; a judge-usable app; a return reason (re-run the vault benchmark when new listings appear); "what breaks without 0G" (§8). Risk: the track asks for a *consumer* app, so we pitch to individuals and small teams choosing AI for their own data. |
| **Arkiv: Build on Arkiv** ($4k) | Listings + buyer-reported scores, read on the browse page | Writes to testnet; a user-visible read; writer wallets + one query in the README; `/arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`; OSS license; AI-use disclosure |
| **EF: Best CROPS App** ($3.5k) | Lead property **C**, scoped honestly: no backend of ours; the client runs from the repo; a dependency/failure matrix lists what still depends on 0G and Arkiv | README `CROPS` section; ≤ 3-min video; no trackers |
| Stretch only | 0G Agents That Pay for Themselves; iAI sign-in | Not on the critical path |

**VERIFY (T11):** the ETHGlobal partner-prize limit per project. Also the Arkiv "built from scratch at Mumbai" rule
against our pre-event commit history: we disclose the history and ask organizers. Moving files doesn't change
provenance.

## 8. "What breaks without 0G"
Without 0G there is no attested sealed container to hold both parties' assets, no private TEE inference for the
customization agent and the classifier, no verifiable storage for encrypted assets and reports, and no escrow chain.
Buyer and seller would have to trust each other, or us, with their data.

## 9. Pinned revisions
| Thing | Pin |
|---|---|
| ERC-8183 reference | `erc-8183/base-contracts@142e669c1fd318486a4628395b629f033654dd06` (solc 0.8.28, cancun) |
| 0G sandbox docs | `0gfoundation/0g-sandbox@ce187a4` |
| 0G-TAPP | `0gfoundation/0g-tapp@e0fc4c2` |
| AgentDNA (reference only) | `0gfoundation/0g-agentic-id@e8cd7a4`, SDK 0.4.0 |
| 0G agent skills | `0gfoundation/0g-agent-skills@04b5a42` (installed by `scripts/setup.sh`) |
| ethers | exactly 6.13.1 (storage SDK peer) |

## 10. Decisions
| # | Decision | Status |
|---|---|---|
| D1 | MVP asset = `llm-classifier/v1` configuration (data only, no seller code) | **Proposed (T00)** |
| D2 | Customization = enumerated recipe search with ≤ 2 experiments, by a planner LLM behind a deterministic policy gate | **Proposed (T00)**, restores the original D9 intent |
| D3 | Worker = our reviewed image in a sealed TEE (W1, else W2), MOCK until G-RT | **Proposed (T00)** |
| D4 | Escrow = ERC-8183 reference unchanged; worker = provider, seller = evaluator; fixed fee; admin renounced | Proposed |
| D5 | No backend of ours; static client + CLI | Kept from rev 1 |
| D6 | Arkiv holds public data only; scores are labelled "buyer-reported" | Revised (R12) |
| D7 | Our own AES-GCM envelope over 0G Storage; random keys + passphrase recovery file | Revised (R08) |
| D8 | Clone sales, AgentDNA assets, ERC-8004 feedback: deferred, not on the critical path | Revised (R10, R11) |
| D9 | ~~No customization~~ **Reopened and reversed**: the customization agent is required | Revised |
| D10 | viem everywhere except the 0G Storage adapter (ethers 6.13.1) | Kept |
| D11 | Docs: PLAN, SECURITY, PROTOCOL, ARCHITECTURE, TASKS, per-phase plans | Revised |

## 11. Open questions (owner task in brackets)
1. 0G: will you register our worker image as a sealed-sandbox snapshot on a testnet provider, and which provider? [T01]
2. 0G: the TappRegistry getter that proves a sandbox provider address is an active attested signer for its app_id. [T01]
3. 0G: does the sealed-sandbox certificate or provider record attest the egress policy, or only the image? [T01]
4. 0G: is a hosted TAPP node available to hackathon teams? [T01]
5. 0G: the current public broker URL (documented paths returned 404). [T01]
6. 0G: Router CIDRs or a stable egress target for the worker's 10-CIDR allowlist. [T01]
7. Arkiv/ETHGlobal: pre-event history and the "from scratch" rule; partner-prize limit. [T11]

## Sources
0G sandbox `README.md`, `docs/API_REFERENCE.md`, `docs/CLI.md`, `docs/APP_IDENTITY.md`,
`docs/sandbox-egress-isolation.md`; 0G-TAPP `README.md`; 0G Router privacy doc
(`docs.0g.ai/.../router/privacy`, updated 2026-09-05); ERC-8183 spec and `contracts/ERC8183.sol`,
`ERC8183WithAuthorization.sol` at the pin; storage SDK `lib.esm/common/encryption.js`; AgentDNA
`sealed/TRUST_MODEL.md`; Arkiv `docs.arkiv.network/llms.txt`; ETHGlobal Mumbai prize pages; PR #1 review.
