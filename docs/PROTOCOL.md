# Protocol v1

Exact data formats for `packages/protocol`. Types and field names here are binding. If code needs to change them,
bump the version and record it in PLAN §10. All hashes are `bytes32`. "Commitment" always means
`keccak256(abi.encode(salt, value))` with a fresh 32-byte random `salt` that is kept private (review R07).

## 1. Identifiers (globally unique, review R16)
- `chainId` 16602 (0G Galileo), `escrow` = ERC-8183 proxy address, `arkivChainId` 7794095.
- `assetId = keccak256(abi.encode("sealedai.asset", chainId, seller, sellerAssetNonce))`; `assetVersion` uint32,
  incremented on any bundle change.
- `offerHash` = EIP-712 struct hash of `Offer`. `manifestHash` = EIP-712 struct hash of `JobManifest`.
- `jobId` is only meaningful together with `(chainId, escrow)`.

## 2. EIP-712
Domain: `{ name: "SealedAI", version: "1", chainId: 16602, verifyingContract: <escrow proxy> }`.

```
Offer(
  address seller, bytes32 assetId, uint32 assetVersion,
  bytes32 assetCommitment,        // commitment to sha256(plaintext bundle)
  bytes32 assetRoot,              // 0G Storage root of the GCM ciphertext
  bytes32 executor,               // keccak256("llm-classifier/v1")
  bytes32 recipeCatalogHash,      // keccak256 of the canonical catalog JSON
  bytes32 workerImageDigest,      // sha256 image config digest the seller accepts
  address token, uint256 price,
  bytes32 licenseHash,            // keccak256 of canonical {calls, hours, scope:"hosted-inference"}
  uint8 maxExperiments,           // <= 2
  uint64 validUntil, uint256 offerNonce)

JobManifest(
  bytes32 offerHash, address buyer, address seller,
  address worker, bytes32 workerKeyHash,       // keccak256(compressed worker pubkey)
  bytes32 evidenceHash,                         // keccak256 of the raw evidence bytes verified
  uint8 runtimeMode,                            // 1 = W1 sealed sandbox, 2 = W2 TAPP, 9 = MOCK
  bytes32 datasetCommitment, bytes32 splitCommitment,   // split = {seed, 60/20/20}
  bytes32 goalCommitment, bytes32 planHash,
  bytes32 plannerPolicyHash, bytes32 outputPolicyHash,
  uint16 maxPlannerCalls, uint32 maxInferenceCalls, uint32 maxWallClockSec,
  bytes buyerSessionPubKey,                     // outputs are encrypted to this
  uint256 jobId, uint64 expiresAt)

KeyRelease(bytes32 manifestHash, uint8 role /*1 seller, 2 buyer*/, bytes32 objectId, bytes32 wrappedKeyHash)

WorkerReceipt(
  bytes32 manifestHash, uint256 jobId,
  bytes32 reportRoot, bytes32 reportCommitment,
  int32 baselineValMetric, int32 selectedValMetric, int32 holdoutMetric,   // x1e4 macro-F1
  uint8 experimentsRun, uint8 stopReason, bytes32 timelineHead, uint8 runtimeMode)
```
The ERC-8183 typed authorizations (`SetBudgetAuthorization`, `SetPayoutReceiverAuthorization`,
`SubmitAuthorization`, `CompleteAuthorization`) use the escrow's own domain `{name: "ERC8183", version: "1"}` and the
exact typehashes in `ERC8183WithAuthorization.sol@142e669`.

## 3. Encrypted object envelope (replaces the SDK's unauthenticated AES-CTR)
```
header = canonical JSON {schema:"sealedai.obj/v1", objectType:"asset"|"dataset"|"report"|"timeline"|"vault",
                         objectId, version, plaintextSha256, size}
blob   = u32be(len(header)) || header || nonce(12) || AES-256-GCM(key, nonce, plaintext, aad=header)
```
Uploaded to 0G Storage with **no SDK encryption**; downloaded with Merkle proof. The reader checks the GCM tag, then
`sha256(plaintext) == header.plaintextSha256`, then that `header` matches the commitment it expected. Any failure
aborts (I10). Canonical JSON = RFC 8785 (JCS).

## 4. Key release
`wrapped = eciesjs.encrypt(workerPubKey, objectKey)`. The party sends `{release: KeyRelease, sig, wrapped}`
(itself ECIES-encrypted to the worker, I8). The worker checks: the signature recovers to `manifest.seller` (role 1)
or `manifest.buyer` (role 2); `manifestHash` equals its loaded manifest; `wrappedKeyHash == keccak256(wrapped)`; the
decrypted key opens the object whose header matches `assetCommitment` / `datasetCommitment`. A release is accepted
once per role; a second, different one aborts the job.

## 5. Worker HTTP API (port 8080, the only interface)
All request bodies are `ECIES(workerPubKey, canonicalJSON({payload, sig, ts, nonce}))`; replies are
`ECIES(recipientKey, …)`. The worker rejects `ts` older than 120 s and repeated `nonce`s.

| Method | Path | Caller | Does |
|---|---|---|---|
| GET | `/v1/identity` | anyone | Returns the evidence (certificate or quote + runtime_data), the pubkey and the mode. Plain JSON (public). |
| POST | `/v1/challenge` | anyone | Signs `keccak256("sealedai.challenge", nonce)` with the worker key (proof of possession) |
| POST | `/v1/manifest` | buyer | Loads the manifest + buyer sig + seller `Offer` + sig. Returns worker-signed `setBudget` / `setPayoutReceiver` authorizations if price, token, image and expiry match |
| POST | `/v1/release` | seller, buyer | Key release (§4) |
| POST | `/v1/run` | buyer | Starts the run when both releases and an on-chain `Funded` job match the manifest |
| GET | `/v1/timeline?after=n` | buyer | Encrypted timeline events |
| GET | `/v1/result` | buyer | Report root, receipt, worker-signed `SubmitAuthorization` |
| POST | `/v1/infer` | buyer | `{text}` → `{label}` during the license window; counts calls |

## 6. Planner (customization agent)
Runs inside the worker. It calls the Router (private mode) with the buyer's released API key. The policy gate
validates each tool call before anything executes.

Tools (JSON-schema enforced, `additionalProperties: false`):
| Tool | Args | Returns |
|---|---|---|
| `inspect_asset_card` | — | Seller's **public** card (delimited as untrusted data) |
| `inspect_data_summary` | — | `{rows, labelHistogram, meanLength}` of train + val (never holdout) |
| `propose_recipe` | `{fewshot:{k,selection}, template:{variant}, decode:{temperature}, labelhints}` with values from the catalog enums | `{proposalId}` or a policy rejection reason |
| `run_experiment` | `{proposalId}` | `{experimentId}`; rejected when 2 experiments have run or budget is short |
| `read_metrics` | `{experimentId}` | `{valAccuracy, valMacroF1, perClass?}` rounded to 3 dp; classes < 5 suppressed |
| `finish` | `{selectedExperimentId \| "baseline", rationale ≤ 500 chars}` | ends the loop |

Policy (deterministic): unknown tool or enum value → reject + event; ≤ `maxPlannerCalls` LLM calls;
≤ 2 `run_experiment`; inference calls counted against `maxInferenceCalls`; wall clock ≤ `maxWallClockSec`; on budget
exhaustion the gate forces `finish` with the best validation result so far. If the Router returns
`503 no_provider_for_trust_mode`, the gate forces `finish("baseline")` with stop reason `PLANNER_UNAVAILABLE`, and
there's no tier fallback (I9). Asset card and metrics are wrapped in delimiters and labelled untrusted in the system
prompt; the policy gate, not the prompt, is the control.

Stop reasons: `1 FINISHED`, `2 BUDGET_CALLS`, `3 BUDGET_TIME`, `4 MAX_EXPERIMENTS`, `5 PLANNER_UNAVAILABLE`,
`6 PLANNER_INVALID` (3 consecutive rejected proposals).

## 7. Timeline event (hash-chained)
`{i, prevHash, ts, kind, data, requestId?}` with `kind ∈ {plan, policy_reject, experiment_start, metrics,
decision, finish, holdout, error}`; `hash_i = keccak256(canonical(event_i))`; the receipt carries `timelineHead`.
`requestId` = the Router `X-Request-ID` for LLM-backed events.

## 8. Report (encrypted object, `objectType: "report"`)
`{protocol:"sealedai/v1", mode, manifestHash, offerHash, executor, recipeCatalogHash, splitSizes, baseline,
experiments:[{id, recipe, val, cost, requestIds, failures}], selected, holdout:{accuracy, macroF1, n,
invalidOutputs}, stopReason, budgetsUsed, timeline:[…], evidence:{runtimeMode, evidenceHash, verifyPolicyVersion},
deps:{workerImageDigest, sdkVersions}}`.

## 9. Application acceptance policy (review R09)
A client accepts a worker or receipt only if **all** of these hold: chain, escrow and domain match; the worker key
hash, evidence hash and runtime mode match the manifest; the evidence passes the mode's verifier (PLAN §5); the image
digest equals the offer's; evidence freshness ≤ 10 min at release time; the receipt signature recovers the worker
key; `manifestHash`, `jobId` and `timelineHead` match the decrypted report. In `mode=MOCK` the result is labelled
MOCK and confidential acceptance is impossible. The report archives the evidence bytes and the policy version for
later audit.

## 10. Arkiv schemas
`sealedai.listing/v1`: `chainId u64, escrow addr, seller addr (indexed), assetId key (indexed), assetVersion u64,
executor str (indexed), category str (indexed), title str (≤ 128 B), price u256, token addr, offerHash key,
offerRoot str (0G root of the full signed Offer JSON), validUntil u64`. Expiration = `validUntil`. A reader shows a
listing only if `$creator == seller`, the full offer verifies, and `validUntil > now`. Strings are rendered as text,
never HTML.

`sealedai.score/v1`: `listingKey key (indexed), assetVersion u64, buyer addr, jobId u256, escrow addr,
holdoutMacroF1 dec (indexed), n u64, protocol str, manifestRoot str, receiptRoot str` (0G roots of the public
manifest JSON, which holds only salted commitments, and of the signed `WorkerReceipt`). Always labelled
**buyer-reported**. A "worker-signed" badge is added only when: the escrow job is `Completed`; `client == buyer`; the
job's `description` equals `"sealedai:v1:" ‖ manifestHash` of the manifest at `manifestRoot`; that manifest's
`offerHash` is the listing's; the receipt verifies against the manifest's worker key with `holdoutMetric` equal to
the score; and `runtimeMode != MOCK`. The badge says who measured the score, not that the benchmark is meaningful. Even then it's one buyer's custom benchmark and not comparable across buyers, so personal rankings are
shown separately.
