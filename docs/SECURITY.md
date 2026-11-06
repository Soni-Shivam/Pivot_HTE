# Security model (revision 3)

Companion to `docs/PLAN.md`. Normative: code and UI copy must not claim more than this file allows.

## 1. Assets and adversaries

| Asset | Owner | Must not reach |
|---|---|---|
| Seller model bundle (architecture, weights, tokenizer) | Seller | Buyer, platform, host, the 0G Router, other jobs |
| Buyer dataset (rows + labels) | Buyer | Seller, platform, host, the 0G Router, other jobs |
| Customized model (LoRA adapter / checkpoint trained on buyer data) | Neither alone | Both parties in plaintext (choice C1); only the buyer, encrypted, if the Offer allows C2 |
| Report (metrics, decisions, costs) | Buyer | Everyone else (public data limited to salted commitments) |
| Buyer goal text and Router API key | Buyer | Seller, platform |

Adversaries: a malicious **platform operator** (our domain, hosting, listings we write); a malicious **seller**
(crafted model file or card, wants buyer data); a malicious **buyer** (crafted data or queries, wants the seller's
weights, wants a free run); the **cloud/host** operator; a **network** attacker; **colluding** wallets. Out of scope,
stated: TEE hardware or side-channel breaks, and a compromise of NVIDIA/Intel attestation roots.

## 2. Invariants (each has acceptance tests in `docs/TASKS.md`)

- **I1 Two-party release.** The worker decrypts nothing without a valid seller `KeyRelease` **and** a valid buyer
  `KeyRelease` for the same `manifestHash`.
- **I2 Own-client verification.** Each party releases only to a worker whose evidence its **own client** verified:
  TDX quote under policy (debug off), `report_data` binding, fresh nonce, approved image digest, worker key bound and
  proven, and for GPU jobs every GPU report verified against NVIDIA, bound to the same evidence, with CC mode on.
  Platform-supplied "verified" flags are ignored.
- **I3 No admin channel.** No SSH, exec, debug endpoint or owner chat into the worker; only the documented API
  (PROTOCOL §5). The TAPP deployer has only the restricted gRPC surface ("malicious deployer" model).
- **I4 No seller code (choice B1).** Models load from `safetensors` + `config.json` for allowlisted architectures
  with `trust_remote_code=False`; pickle and remote code are refused. Tokenizers are loaded by our pinned library.
- **I5 Planner has no authority.** The LLM proposes; the policy gate decides. Enumerated tools and values; budgets
  counted by code; no shell, network, files, signing, spending or key release.
- **I6 Holdout isolation.** Holdout rows are loaded only after `finish`, evaluated exactly once; no holdout-derived
  number reaches the planner.
- **I7 Bounded outputs.** The worker emits only: the encrypted report and timeline (to the buyer), the receipt, and
  `/v1/infer` outputs per the task adapter policy (`text-classification`: a label from the label set). With C2, the
  adapter encrypted to the buyer. Never weights, rows or keys.
- **I8 End-to-end transit.** Client→worker payloads are ECIES-encrypted to the attested worker key and signed;
  worker→client payloads are encrypted to the recipient's session key. TLS is extra.
- **I9 Router: aggregates only, private tier only.** Router prompts contain only the public card, the buyer's goal
  text, the numeric data summary and rounded aggregate metrics. Only `X-0G-Provider-Trust-Mode: private`, with a
  private-only key; a 503 stops the step, with no tier fallback.
- **I10 Fail closed on crypto.** Wrong key, modified ciphertext or AAD, truncation, hash mismatch, bad signature,
  stale evidence: abort. (The 0G SDK's own `aes256` mode is never used.)
- **I11 No low-entropy public data.** Chain and Arkiv carry only salted commitments.
- **I12 No unverified path to acceptance.** No product mode accepts unverified evidence. Development tests on non-TEE
  hardware use synthetic data and test-only fixtures that live in test files; the production client has no flag or
  code path to accept them, and a CI check enforces that.

## 3. Who sees plaintext (complete list)

| Recipient | Sees | Trust basis |
|---|---|---|
| Sealed worker CPU (TDX) + GPU (NVIDIA CC) | Seller model, buyer data, customized model, buyer Router key | G-RT evidence (I2); our reviewed image |
| 0G Router gateway + TeeML provider | Public model card, buyer goal text, numeric data summary, rounded aggregate metrics. **No weights, no rows.** | Private tier; in memory per the 0G privacy doc; the buyer sees exactly what's sent in the timeline |
| TEE runtime operator stack (0G-TAPP; or the sandbox provider for H4, which generates the container key) | Nothing in plaintext, by design; it's in the trusted computing base | Measured, registered in TappRegistry; disclosed |
| Seller | Own model; job status; payout | n/a |
| Buyer | Own data; report; `/v1/infer` outputs; the adapter if C2 | n/a |
| Platform (us) | Public chain and Arkiv data only | No backend exists |
| RPC / Arkiv / indexer / cloud | Addresses, public data, ciphertext, VM metadata | Swappable or untrusted by design |

Egress from the worker: only the 0G Storage indexer, 0G RPC and the Router host, enforced in worker code, and
additionally by the runtime's network allowlist where one exists (TAPP compose network config / sandbox
`networkAllowList`; **VERIFY** in T01).

## 4. Residual risks we state publicly
1. **Query extraction:** `/v1/infer` labels let a buyer probe the customized model (distillation); capped by the
   license call count, and outputs are labels only.
2. **Aggregates leak a little:** planner prompts carry rounded metrics and a data summary to the 0G private tier;
   the buyer approves the goal text and sees every prompt in the timeline.
3. **Availability:** a worker crash loses its memory-only keys and ends the job or license; the buyer may lose
   remaining license calls after paying (MVP fairness limit).
4. **The C2 adapter** is trained on buyer data and released to the buyer. It may carry some information about the
   base weights' behaviour; the seller opts in per Offer.
5. Hardware, side-channel and attestation-root compromises are out of scope.

## 5. Allowed and forbidden claims

| Allowed (once evidenced) | Forbidden |
|---|---|
| "Your data and their model met only inside a TEE that both of you verified." (G-RT) | "Trustless", "zero-knowledge", "nobody can learn anything" |
| "The platform never holds a key, a model or your data." | Any confidential label without CPU **and** GPU evidence verified |
| "The AI agent only saw aggregate numbers; request IDs: …" | "Fully private AI" for the agent (the gateway sees its prompts) |
| "Final score measured once on held-out data the agent never saw." | "Verified quality", "guaranteed improvement" |
| "Buyer-reported score" | "Independent verified evaluation", "sybil-resistant" |
| "Runs from the repo with no server of ours; depends on 0G, the TEE host and Arkiv as listed." | "Works without anyone" |
