# Security model

Companion to `docs/PLAN.md` §2. This file is normative: code and UI copy must not claim more than it allows.

## 1. Assets and adversaries

| Asset | Owner | Must not reach |
|---|---|---|
| Seller bundle (templates, guidelines, seller examples) | Seller | Buyer, platform, host, other jobs |
| Buyer dataset (text + labels) and goal text | Buyer | Seller, platform, host, other jobs |
| Selected configuration (mixes both) | Neither alone | Both parties in plaintext; only usable via the worker |
| Report (metrics, decisions, costs) | Buyer | Everyone else (public data limited to salted commitments) |
| Buyer's Router API key | Buyer | Seller, platform |

Adversaries considered: a malicious **platform operator** (controls our domain, any hosting, the Arkiv listings it
writes); a malicious **seller** (crafted templates and asset card, prompt injection, wants buyer data); a malicious
**buyer** (crafted inputs, wants seller templates, wants a free run); the **host or cloud** operator; a **network**
attacker; **colluding** wallets. Out of scope: TEE hardware breaks and side channels (stated, not solved), and a
compromise of 0G's Router, TeeML providers or sandbox provider code (explicitly trusted, see §3).

## 2. Invariants (each has an acceptance test in `docs/TASKS.md`)

- **I1 Two-party release.** The worker decrypts nothing unless it holds a valid seller `KeyRelease` **and** a valid
  buyer `KeyRelease` for the same `manifestHash`. Either party withholding stops the job.
- **I2 Approved code only.** A release is sent only to a worker whose evidence the releasing party's **own client**
  verified: image digest == `offer.workerImageDigest`, a fresh certificate/quote, a key bound to the evidence, and
  the possession challenge signed. Platform-supplied "verified" flags are ignored.
- **I3 No admin channel.** In confidential mode the worker runs sealed: no SSH, no exec/toolbox, no owner chat, no
  debug endpoints. The only interface is the documented worker HTTP API (PROTOCOL §5).
- **I4 No seller code.** The executor runs only our reviewed code. The seller bundle is data, parsed against a schema
  with size limits.
- **I5 Planner has no authority.** The LLM proposes; the policy gate decides. Tools are enumerated; params are
  enumerated; budgets are counted by code. The LLM can't run shell commands, open connections, name files, sign,
  spend or release keys.
- **I6 Holdout isolation.** Holdout rows are read only after `finish`, exactly once. No planner input ever contains
  holdout-derived numbers.
- **I7 Bounded outputs.** The worker emits only: the encrypted report (to the buyer), the receipt, the timeline
  (encrypted to the buyer), and `/infer` labels from `labelSet`. Never free text, templates, examples or keys.
- **I8 End-to-end transit.** Every client→worker payload is ECIES-encrypted to the attested worker key and signed by
  the sender. Every worker→client payload is encrypted to the recipient's session key. TLS is extra, not relied on.
- **I9 No private-tier downgrade.** Router calls use only `X-0G-Provider-Trust-Mode: private` with a key configured
  for private-only routing. A 503 `no_provider_for_trust_mode` stops that step; no retry on `verified` or `standard`.
- **I10 Fail closed on crypto.** Wrong key, modified ciphertext or AAD, truncated download, hash mismatch, bad
  signature, stale evidence: each one aborts, never continues with garbage (the 0G SDK's own `aes256` mode would
  silently return ciphertext; we don't use it).
- **I11 No public low-entropy leaks.** On-chain and Arkiv data contain only salted commitments, never raw case,
  answer, label or dataset hashes.
- **I12 MOCK is loud.** Anything produced without passing G-RT says MOCK in the data (a `mode` field) and in the UI,
  and can't satisfy confidential-mode verification.

## 3. Who sees plaintext (complete list)

| Recipient | Sees | When | Trust basis |
|---|---|---|---|
| Sealed worker (TEE) | Seller bundle, buyer dataset, Router key | During the job and license window | G-RT evidence; our reviewed image |
| 0G Router gateway | Rendered prompt (template + examples + one buyer text) and the label answer; planner prompts (aggregates only) | Per call, in memory | 0G privacy doc: in memory only, never written to storage. **Trusted and disclosed** (review R02). |
| TeeML provider (TDX) | Same as the gateway, inside its TEE | Per call | Private trust mode; `verify_tee: true` |
| Sandbox provider app (W1) | Generates the container key before injection (AgentDNA TRUST_MODEL notes this hop) | At create | Measured provider app registered in TappRegistry. **Trusted and disclosed.** |
| Seller | Its own bundle; job status; the payout | Always | n/a |
| Buyer | Its own data; report; labels from `/infer` | Always | n/a |
| Platform (us) | Nothing beyond public chain/Arkiv data | n/a | No backend exists |
| RPC / Arkiv / indexer operators | Wallet addresses, public tx/entity data, ciphertext | Always | Swappable endpoints (CROPS P) |

Egress: in W1 the worker sandbox is created with `networkAllowList` = CIDRs for the Router, 0G Storage indexer and 0G
RPC (≤ 10 CIDRs; **VERIFY** that stable CIDRs exist). The worker code also enforces its own host allowlist. Whether
the provider attests the egress policy to the seller is open (PLAN §11 Q3), so I4 + I7 (reviewed code, bounded
output) are the primary control, and the network allowlist is defence in depth.

## 4. Residual risks we state publicly
1. Labels returned by `/infer` leak at most log2(|labelSet|) bits per call about the seller's config; capped by the
   license call count.
2. Aggregate metrics and the planner's choices are not sent to the seller (the seller receives only job status and
   payment), but they do reach the 0G gateway in planner prompts: aggregates only, rounded to 3 decimals, classes
   under 5 samples suppressed.
3. A worker restart ends the job/license (keys are memory-only). The buyer may lose remaining license calls after
   paying. That's the MVP fairness limit.
4. TEE hardware and side-channel attacks, and 0G Router/provider/sandbox compromise, are out of scope.
5. In MOCK mode there is **no** confidentiality: synthetic data only.

## 5. Allowed and forbidden claims (UI, README, demo)

| Allowed (once its evidence exists) | Forbidden |
|---|---|
| "Each party released its key only after its own client verified the worker." (G-RT) | "Trustless", "zero-knowledge", "nobody can learn anything" |
| "The platform never holds a key or your data." | "Attested" or "confidential" for MOCK runs or anything without G-RT evidence |
| "Requests to 0G Private Computer used private (TEE-only) routing; request IDs: …" | "Fully private inference": the gateway sees prompts in memory |
| "Final score measured once on a held-out split the agent never saw." | "Verified quality", "guaranteed improvement" |
| "Buyer-reported score" (for Arkiv scores) | "Independent verified evaluation", "sybil-resistant" |
| "Runs from the repo with no server of ours; depends on 0G and Arkiv as listed." | "Works without anyone" / "fully censorship-resistant" |
