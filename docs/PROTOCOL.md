# Protocol v1 (revision 3)

Exact data formats for `packages/protocol` and `worker/ml`. Field names are binding. Changing them = version bump +
PLAN §10 entry. Hashes are `bytes32`. A "commitment" is always `keccak256(abi.encode(salt, value))` with a fresh
private 32-byte `salt` (review R07).

## 1. Identifiers
`chainId` 16602, `escrow` = ERC-8183 proxy, `arkivChainId` 7794095.
`assetId = keccak256(abi.encode("sealedai.asset", chainId, seller, sellerAssetNonce))`; `assetVersion` uint32,
incremented on any bundle change. `offerHash` / `manifestHash` = EIP-712 struct hashes. `jobId` is meaningful only
with `(chainId, escrow)`.

## 2. EIP-712
Domain `{ name: "SealedAI", version: "1", chainId: 16602, verifyingContract: <escrow proxy> }`.

```
Offer(
  address seller, bytes32 assetId, uint32 assetVersion,
  bytes32 assetCommitment,          // commitment to sha256(bundle tar)
  bytes32 assetRoot,                // 0G Storage root of the sealed bundle
  bytes32 format,                   // keccak256("hf-safetensors/v1")
  bytes32 task,                     // keccak256("text-classification")
  bytes32 architecture,             // keccak256 of config.json "architectures"[0]
  bytes32 recipeCatalogHash,
  bytes32 workerImageDigest,        // the only worker image allowed to receive the key
  bytes32 evidencePolicyHash,       // keccak256 of canonical {runtimes allowed, TCB policy, GPU required}
  address token, uint256 price,
  bytes32 licenseHash,              // keccak256 of canonical {calls, hours, scope:"hosted-inference", adapterExport:bool}
  uint8 maxTrainingRuns,            // <= 2
  uint64 validUntil, uint256 offerNonce)

JobManifest(
  bytes32 offerHash, address buyer, address seller,
  address worker, bytes32 workerKeyHash, bytes32 evidenceHash,
  uint8 runtime,                    // 1 TAPP+GPU (TDX+H100), 2 TAPP CPU (TDX), 3 sealed sandbox CPU, 4 dstack+GPU
  bytes32 datasetCommitment, bytes32 splitCommitment,
  bytes32 goalCommitment, bytes32 planHash,
  bytes32 plannerPolicyHash, bytes32 outputPolicyHash,
  uint16 maxPlannerCalls, uint32 maxGpuSeconds, uint32 maxWallClockSec, uint32 maxInferenceCalls,
  bytes buyerSessionPubKey, uint256 jobId, uint64 expiresAt)

KeyRelease(bytes32 manifestHash, uint8 role /*1 seller, 2 buyer*/, bytes32 objectId, bytes32 wrappedKeyHash)

WorkerReceipt(
  bytes32 manifestHash, uint256 jobId, bytes32 reportRoot, bytes32 reportCommitment,
  int32 baselineValMetric, int32 selectedValMetric, int32 holdoutMetric,   // macro-F1 x 1e4
  uint8 trainingRuns, uint8 stopReason, bytes32 timelineHead, bytes32 evidenceHash, uint8 runtime)
```
The ERC-8183 authorizations (`SetBudgetAuthorization`, `SetPayoutReceiverAuthorization`, `SubmitAuthorization`,
`CompleteAuthorization`) use the escrow's domain `{name: "ERC8183", version: "1"}` and the typehashes in
`ERC8183WithAuthorization.sol@142e669`.

## 3. Encrypted object envelope
```
header = canonical JSON {schema:"sealedai.obj/v1", objectType:"model"|"dataset"|"report"|"timeline"|"adapter"|"vault",
                         objectId, version, plaintextSha256, size}
blob   = u32be(len(header)) || header || nonce(12) || AES-256-GCM(key, nonce, plaintext, aad=header)
```
Large objects (model bundles) are chunked: `chunkSize` = 64 MiB; each chunk is its own blob with
`objectId = <bundleId>#<i>`, and a sealed `manifest` object lists the chunk roots and the whole-tar sha256.
Uploads use **no SDK encryption**. The reader verifies the tag, then the sha256, then the expected header, and aborts
on any failure (I10). Canonical JSON = RFC 8785.

## 4. Model bundle `hf-safetensors/v1` (choice B1)
A deterministic tar (sorted paths, zeroed mtimes/owners) containing `config.json`, `*.safetensors`, tokenizer files
(`tokenizer.json` and/or `vocab.txt`, `tokenizer_config.json`, `special_tokens_map.json`) and `card.json`:
```
card.json = { name, task, architecture, parameters, license, labels?:[...], inputSchema, outputSchema,
              allowedTargets:[module names for LoRA], maxLen, publicDescription }
```
Loader rules (worker/ml): reject any file outside this list; reject `.bin`, `.pt`, `.pkl` and any `auto_map` or
custom code; `config.architectures[0]` must be on the allowlist (MVP: `DistilBertForSequenceClassification`,
`BertForSequenceClassification`, `Qwen2ForCausalLM`); load with `trust_remote_code=False`; the parameter count must
match the card ± 1 %.

## 5. Key release
`wrapped = ECIES(workerPubKey, objectKey)` (eciesjs on the client, eciespy in the worker; T06 proves byte
compatibility). Sent as `{release: KeyRelease, sig, wrapped}`, itself ECIES-encrypted to the worker (I8). The worker
checks: the signer is `manifest.seller` (role 1) or `manifest.buyer` (role 2); `manifestHash` matches;
`wrappedKeyHash == keccak256(wrapped)`; the key opens an object whose header matches the committed one. One release
per role; a conflicting second one aborts the job.

## 6. Worker HTTP API (8080; the only interface)
Bodies are `ECIES(workerPubKey, canonical({payload, sig, ts, nonce}))`; replies are `ECIES(recipientKey, …)`;
`ts` within 120 s; nonces single-use.

| Method | Path | Caller | Does |
|---|---|---|---|
| GET | `/v1/identity` | anyone | Evidence bundle: TDX quote, event log, runtime_data, GPU reports (runtime 1/4) or v3 certificate (runtime 3); worker pubkey; image digest. Public JSON. |
| POST | `/v1/challenge` | anyone | Signs `keccak256("sealedai.challenge", nonce)`; for runtimes 1/2, also returns fresh TAPP evidence with that nonce |
| POST | `/v1/manifest` | buyer | Loads manifest + buyer sig + Offer + seller sig; returns worker-signed `setBudget`/`setPayoutReceiver` authorizations if price, token, image, evidence policy and expiry match |
| POST | `/v1/release` | seller, buyer | Key release (§5); the buyer's release also carries its Router key |
| POST | `/v1/run` | buyer | Starts when both releases are valid and the escrow job is Funded with exactly the manifest's terms |
| GET | `/v1/timeline?after=n` | buyer | Encrypted timeline events |
| GET | `/v1/result` | buyer | Report root, receipt, worker-signed `SubmitAuthorization` |
| POST | `/v1/infer` | buyer | Task-adapter input → output per policy, during the license; counted |
| GET | `/v1/adapter` | buyer | Only if the Offer's license has `adapterExport: true` (C2): the LoRA adapter sealed to the buyer |

## 7. Customization agent (planner)
Runs in the worker's control plane; calls the Router (private tier) with the buyer's released key. The policy gate
validates every tool call.

| Tool | Args | Returns |
|---|---|---|
| `inspect_asset_card` | — | Public `card.json` (delimited as untrusted data) |
| `inspect_data_summary` | — | `{rows:{train,val}, labelHistogram, tokenLenP50, tokenLenP95}` (never holdout) |
| `propose_recipe` | `{method:"lora"\|"head_only", lora?:{r,alpha,dropout,targets}, optim:{lr,epochs,batch,warmup}, classWeights, maxLen}`, all values from catalog enums | `{proposalId}` or a rejection reason |
| `run_training` | `{proposalId}` | `{runId}`; rejected after 2 runs or when the GPU-seconds/time budget is short |
| `read_metrics` | `{runId \| "baseline"}` | `{trainLoss, valLoss, valAccuracy, valMacroF1, perClass?}`, 3 dp; classes < 5 suppressed |
| `finish` | `{selected: runId \| "baseline", rationale ≤ 500 chars}` | Ends the loop |

Policy: unknown tool or value → reject + event; ≤ `maxPlannerCalls`; ≤ 2 `run_training`; GPU-seconds and wall clock
metered by code; on exhaustion the gate forces `finish(best-by-val)`. On Router `503 no_provider_for_trust_mode`: no
tier fallback, gate forces `finish(best-by-val)` with stop reason 5. The card and metrics are delimited as untrusted
in the system prompt; the gate, not the prompt, is the control.
Stop reasons: `1 FINISHED, 2 BUDGET_CALLS, 3 BUDGET_TIME, 4 MAX_RUNS, 5 PLANNER_UNAVAILABLE, 6 PLANNER_INVALID`.

Training determinism: seeds fixed per run (`seed = H(manifestHash, runId)`), `torch.use_deterministic_algorithms`
where supported; reproducibility tolerance stated per task in the report.

## 8. Timeline and report
Timeline event `{i, prevHash, ts, kind, data, requestId?}`, `kind ∈ {plan, policy_reject, train_start,
train_end, metrics, decision, finish, holdout, error}`, hash-chained; `timelineHead` is in the receipt.
Report (sealed, `objectType: "report"`): `{protocol, runtime, manifestHash, offerHash, task, architecture,
recipeCatalogHash, splitSizes, baseline, runs:[{id, recipe, metrics, gpuSeconds, requestIds, failures}], selected,
holdout:{accuracy, macroF1, n}, stopReason, budgetsUsed, timeline, evidence:{bytes, verifyPolicyVersion},
deps:{workerImageDigest, libVersions}}`.

## 9. Evidence verification and acceptance policy
**Worker evidence** (client, before release):
- Runtime 1/2 (TAPP): DCAP quote valid via dcap-qvl; TCB status in the allowed set; TD attributes debug=0;
  `sha512(runtime_data bytes as transmitted) == report_data`; `runtime_data.nonce` == our nonce; the event log replay
  shows the approved compose with `workerImageDigest`; the worker key is `runtime_data.signer`, or is signed by it
  for this job, and signs our challenge.
- Runtime 1/4 (GPU): each GPU report verified with NVIDIA's verifier (T01 picks NRAS or local), CC mode on, nonce
  binding per TAPP `docs/EVIDENCE_AND_AS_VERIFICATION.md`; any GPU unverified → reject.
- Runtime 3 (sealed sandbox): v3 certificate signature recovers the provider; the provider is active for its
  `app_id` in TappRegistry; `image_hash == workerImageDigest`; fresh `ts`; challenge signed by `pubkey`.

**Receipt acceptance:** chain, escrow, domains, worker key, `evidenceHash`, `runtime`, image digest, timeline head and
report contents all match the manifest. Evidence freshness is judged at release time from archived bytes.

## 10. Arkiv schemas
`sealedai.listing/v1`: `chainId u64, escrow addr, seller addr (idx), assetId key (idx), assetVersion u64, task str
(idx), architecture str (idx), category str (idx), title str (≤128 B), parameters u64, price u256, token addr,
offerHash key, offerRoot str, validUntil u64`. Shown only if `$creator == seller`, the offer verifies, and it's
still valid. Strings are rendered as text.
`sealedai.score/v1`: `listingKey key (idx), assetVersion u64, buyer addr, jobId u256, escrow addr, holdoutMacroF1 dec
(idx), n u64, protocol str, manifestRoot str, receiptRoot str`. Always "buyer-reported"; a "worker-signed" badge only
when the job is Completed, `client == buyer`, the description matches the manifest, the manifest's offer is the
listing's, and the receipt verifies with that holdout metric. Personal rankings are shown separately.
