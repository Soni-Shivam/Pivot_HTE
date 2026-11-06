# Response to the PR #1 review (revision 2, updated for revision 3)

> **Revision 3 changes some of the answers below** (the user's decisions, 2026-11-06): the seller asset is now a
> real model trained inside the enclave (not an `llm-classifier/v1` config), there is no MOCK mode, and the 0G
> Router sees aggregates only. That strengthens the answers to D9 (real training), R01/R02 (no asset ever reaches the
> Router gateway; GPU TEE evidence added) and R14 (metrics are computed by our code, not an LLM). Where a row below
> says "config", "MOCK" or "classifier calls via Router", read PLAN rev 3 instead.

Review by Parav29 on `docs/architecture-plan@da2e53d`. Each point: accepted or not, what changed, and where.
All 16 points and the D9 product comment are accepted. Nothing here is implemented yet; acceptance tests live in
`docs/TASKS.md`.

| # | Point | Response | Where |
|---|---|---|---|
| D9 | Restore the customization agent; seller asset, agent and worker are separate roles | **Accepted.** D9 is reversed. A planner LLM on 0G Private Computer with 6 structured tools, an enumerated recipe catalog, ≤ 2 experiments, validation feedback, a locked final holdout and a deterministic policy gate. MVP asset `llm-classifier/v1` = configuration customization, named as such. | PLAN §1, §3.3, D2; PROTOCOL §6; ARCH §2, §7, §8; T02A, T02B |
| R01 | A seller-controlled agent breaks buyer confidentiality and removes joint release | **Accepted.** AgentDNA is dropped as the worker. Our reviewed image runs in a 0G **sealed sandbox** (no SSH/exec for its lifetime, certified image digest, fresh container key) or 0G-TAPP; both parties verify independently and release keys 2-of-2. Until G-RT passes: MOCK mode, synthetic data only. | PLAN §2, §5; SECURITY I1–I4; ARCH §6, §13; T02 |
| R02 | No end-to-end ingress/egress policy | **Accepted.** App-layer ECIES both ways, so proxies see ciphertext and TLS isn't relied on (I8). Complete plaintext-recipient table, with the 0G gateway and the sandbox provider named as trusted. No seller code; worker host allowlist + sandbox CIDR allowlist; label-only outputs. We kept the conservative gateway disclosure, even though the 0G privacy doc says in-memory/zero-retention. | SECURITY §3, I7, I8; ARCH §12; T02 canary test |
| R03 | The buyer can't call provider-only `setBudget` | **Accepted.** Verified at `ERC8183.sol@142e669`. The worker is the provider and signs `setBudgetWithAuthorization` (and the payout receiver) only when it matches the seller's signed Offer; the buyer relays. | PLAN §6; ARCH §6, §9; T03 tests |
| R04 | Payment checks allow replay and the wrong job | **Accepted, and the cause removed.** Pay-per-call is dropped. One fixed-fee job; manifest-bound key releases (single-use per role); worker requests carry ts + nonce + signature; `/v1/run` checks exact on-chain terms. | PLAN §6; PROTOCOL §4, §5; T04 |
| R05 | Prepaid calls don't give one-call loss | **Accepted, and the cause removed.** No streaming payments. The seller is paid only after the worker submits; remaining risk (worker dies during the license window) is disclosed. | SECURITY §4.3; ARCH §9 |
| R06 | Refund claims omit pending claims and grace | **Accepted.** Claims are never used, so `PendingClaimExists` can't arise. The grace rule is modelled, and the tests cover outsider refund, the grace boundary and seller reject. | ARCH §9; T03 tests |
| R07 | Public request hashes leak low-entropy cases | **Accepted.** Only salted commitments are public; the job description is `sealedai:v1:` + manifest hash. | PROTOCOL header, §2; SECURITY I11 |
| R08 | Fixed-message signature as the vault secret | **Accepted.** Random per-object keys, a random master key, scrypt passphrase recovery file. Also found: the SDK's `aes256` is unauthenticated AES-CTR, so we use our own AES-GCM envelope with header AAD. | PLAN §3.4, D7; PROTOCOL §3; ARCH §11; T06 |
| R09 | Proof success isn't an acceptance policy | **Accepted.** Explicit application acceptance policy (chain, escrow, domain, key, evidence, mode, image, freshness at release time, timeline head) with archived evidence. | PROTOCOL §9; T05 |
| R10 | Three prompt probes can't authorize clone sales | **Accepted.** Clone sales deferred (T12); the "HOLDS" verdict removed with the old Phase 1 plan. | PLAN D8; T12 |
| R11 | Purchase authorizer accepts weak evidence | **Accepted.** Deferred with clones; T12 carries the full entitlement requirements. | T12 |
| R12 | Scores aren't trustworthy rankings | **Accepted.** Always "buyer-reported"; a "worker-signed" badge only with a completed job and a verifying receipt, never for MOCK; personal rankings separate; "sybil-resistant" removed. | PROTOCOL §10; SECURITY §5; T07 |
| R13 | Example 03 downgrades the trust tier | **Accepted.** Example 03 becomes private-only, the diagnostic is split out, and a private-only key is configured. | SECURITY I9; T08 |
| R14 | No adversarial or reproducibility spec for the grader | **Accepted.** No LLM grader in money or decision paths: objective metrics only; LLM text is advisory. Injection, malformed-JSON, 503, budget and reproducibility tests on the planner and Router adapter. | PLAN §2; T02A, T02B, T08 |
| R15 | CROPS and fresh-clone promises exceed the repo | **Accepted.** The claim is scoped to independence from *us*, with a dependency/failure matrix; `scripts/setup.sh` for `.0g-skills`; LICENSE/package mismatch → T11; admin renouncement tested against grant/pause/withdraw/upgrade and the role-event history; atomic proxy init, unpaused before renounce. | ARCH §15; T01, T03, T11 |
| R16 | ID namespaces and dependency drift | **Accepted.** Chain/escrow/asset/version namespaces; schema versions; listing validity; exact pins (ethers `6.13.1`); Arkiv SDK install in T01; the stack-skill ERC-7857 contradiction fixed. | PROTOCOL §1, §10; T01, T07 |

## Things the review proposed that we changed slightly
- **Planner location:** it runs inside the worker (so its inputs never leave the TEE except to the 0G private tier),
  plus one pre-run planning call from the buyer's client on a numeric data summary so the buyer can approve the plan.
- **Use after customization:** the deliverable is hosted inference from the sealed worker for a license window
  (labels only), because the selected config mixes both parties' secrets and neither side should receive it.

## Open, needing 0G answers (PLAN §11)
Snapshot registration for W1, the TappRegistry getter, whether egress is attested, hosted TAPP availability, the
public broker URL, and Router CIDRs.
