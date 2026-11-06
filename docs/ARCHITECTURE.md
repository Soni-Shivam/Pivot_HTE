# Architecture (revision 2)

Diagrams for `docs/PLAN.md`. Exact formats are in `docs/PROTOCOL.md`; security rules in `docs/SECURITY.md`
(invariants I1–I12 are referenced below). Each section has one diagram and a few words on why.

Legend: **ours** = code we write · **reused** = published component used unchanged · **external** = a network or
service we call.

---

## 1. System map

```mermaid
flowchart LR
    subgraph DEV["User devices (ours, open source, no backend)"]
        SC["Seller client<br/>web or CLI"]
        BC["Buyer client<br/>web or CLI"]
    end

    subgraph TEE["Sealed TEE worker (our reviewed image; W1 sandbox or W2 TAPP)"]
        API["Worker API<br/>ECIES in and out"]
        GATE["Policy gate<br/>budgets, enums, output rules"]
        PLAN["Customization agent<br/>planner loop"]
        EXEC["Executor<br/>llm-classifier/v1"]
        API --> GATE
        GATE <--> PLAN
        GATE --> EXEC
    end

    subgraph ZG["0G (external)"]
        CHAIN["0G Chain<br/>ERC-8183 escrow (reused)"]
        STORE[("0G Storage<br/>GCM ciphertext")]
        ROUTER["0G Private Computer Router<br/>private TeeML only"]
        REG["TappRegistry<br/>provider identities"]
    end

    ARKIV[("Arkiv<br/>listings, buyer-reported scores")]

    SC -- "encrypted bundle" --> STORE
    SC -- "listing" --> ARKIV
    BC -- "browse" --> ARKIV
    SC & BC -- "verify evidence" --> REG
    SC & BC -- "key release, 2-of-2" --> API
    BC -- "job, fund, relay worker signatures" --> CHAIN
    SC -- "complete, get paid" --> CHAIN
    EXEC -- "classify" --> ROUTER
    PLAN -- "decide (aggregates only)" --> ROUTER
    EXEC -- "read ciphertext" --> STORE
    API -- "encrypted report" --> STORE
    API -- "reads job state" --> CHAIN
```

**Why:** the three roles the review separated are three different boxes. The seller's asset is data in Storage. The
customization agent plans. The worker and its policy gate are the only place both assets are ever in plaintext, and
they run inside a TEE that each party verifies itself. We run no server: clients talk to 0G and Arkiv directly.

---

## 2. Roles and authority

```mermaid
flowchart TB
    subgraph PROPOSE["Can only propose"]
        LLM["Planner LLM<br/>(0G Router, private)"]
    end
    subgraph DECIDE["Decides, deterministic code"]
        G["Policy gate<br/>catalog enums, 2 experiments max,<br/>call/time budgets, holdout lock"]
    end
    subgraph CONSENT["Consent, human wallets"]
        S["Seller: offer + key release"]
        B["Buyer: plan approval + manifest + key release + funding"]
    end
    LLM -- "tool call JSON" --> G
    G -- "accepted or rejected, logged" --> LLM
    S --> G
    B --> G
    G -. "never" .-> NO["shell · network · files · signing · spending · key release"]
```

**Why:** an LLM must not hold authority (I5). It picks among enumerated options, and code enforces every limit.
Consent comes only from the two parties' wallets, so neither the LLM nor we can start a job or release a key.

---

## 3. Who builds what

```mermaid
flowchart LR
    subgraph REUSED["Reused unchanged (pinned)"]
        R1["0G sealed sandbox / 0G-TAPP"]
        R2["ERC-8183 + WithAuthorization<br/>@142e669"]
        R3["0G Storage SDK (no SDK crypto)"]
        R4["0G Router"]
        R5["Arkiv SDK 1.0.1"]
        R6["noble ciphers/hashes, eciesjs,<br/>dcap-qvl"]
    end
    subgraph OURS["Ours"]
        P["packages/protocol"]
        PL["packages/planner"]
        CL["packages/client"]
        W["packages/worker + image"]
        I["packages/integrations"]
        A["apps/cli, apps/web"]
        C["contracts: deploy + renounce + tests"]
    end
    P --> PL & CL & W
    W --> PL & I
    CL --> I
    A --> CL
    I --> R3 & R4 & R5
    CL --> R6
    W --> R6
    C --> R2
    W -. "runs on" .-> R1
```

**Why:** security-critical primitives (TEE isolation, attestation, escrow accounting, ciphers) are reused. What we
write is protocol glue, the policy gate and the executor, which is exactly the product-specific part nobody else has
built.

---

## 4. Seller lists an asset

```mermaid
sequenceDiagram
    autonumber
    actor S as Seller client
    participant ST as 0G Storage
    participant AK as Arkiv
    S->>S: bundle JSON → schema check → fresh key K_a → AES-GCM envelope
    S->>ST: upload ciphertext (no SDK crypto)
    ST-->>S: assetRoot
    S->>S: sign Offer {assetCommitment, assetRoot, executor, recipeCatalogHash, workerImageDigest, price, license, validUntil}
    S->>ST: upload signed Offer JSON
    ST-->>S: offerRoot
    S->>AK: create listing/v1 {offerHash, offerRoot, price, category, ...} expires at validUntil
    S->>S: keep K_a in local keystore (recovery file)
```

**Why:** the seller pins *which worker image* may ever see the asset (`workerImageDigest`), so a later image change
needs a new offer. The asset is encrypted with an authenticated envelope because the SDK's built-in mode is AES-CTR
without authentication (I10).

---

## 5. Buyer states a goal; the agent proposes a plan

```mermaid
sequenceDiagram
    autonumber
    actor B as Buyer client
    participant AK as Arkiv
    participant R as 0G Router (private)
    B->>AK: query listings by category
    B->>B: verify Offer signature, creator == seller, validUntil
    B->>B: local data summary: rows, label histogram, mean length (no text)
    B->>R: planner prompt: goal + public asset card + summary + catalog
    R-->>B: proposed plan JSON + X-Request-ID
    B->>B: policy check of the plan (enums, ≤2 experiments, budgets)
    B->>B: buyer approves → planHash, goalCommitment (salted)
```

**Why:** the buyer sees and approves the plan before anything is unlocked. Only a numeric summary leaves the buyer's
device, and only to 0G's private tier. The approved plan is a starting point; the agent can adapt it inside the
worker, but only within the same policy.

---

## 6. Worker creation and two-party key release

```mermaid
sequenceDiagram
    autonumber
    actor B as Buyer client
    actor S as Seller client
    participant P as Sandbox provider (TEE app)
    participant W as Sealed worker
    participant E as ERC-8183 escrow
    B->>P: create sealed sandbox (snapshot = worker image, networkAllowList)
    P->>W: inject container key + v3 certificate (seal_id, pubkey, image_hash)
    B->>W: GET /v1/identity, POST /v1/challenge(nonce)
    B->>B: verify certificate, provider in TappRegistry, image == offer, signed nonce
    B->>E: createJob(provider=W, evaluator=S, expiredAt, "sealedai:v1:"+manifestHash, hook=0)
    B->>W: POST /v1/manifest (manifest + offer + signatures)
    W-->>B: signed setBudget(price) + setPayoutReceiver(S)
    B->>E: relay both, then fund(expectedToken, expectedBudget)
    S->>W: GET identity + challenge (own nonce)
    S->>S: verify evidence, manifest vs own offer, job on chain Funded with exact terms
    S->>W: KeyRelease(asset) ECIES to worker key
    B->>W: KeyRelease(dataset) + Router key, ECIES to worker key
    W->>W: start only if both releases are valid for this manifestHash
```

**Why:** each party trusts only what its own client checked (I2), and the worker needs both keys (I1). The worker is
the escrow *provider*, so price and payout come from worker-signed authorizations that the worker issues only if the
seller's signed offer matches. No platform signer is involved, and the seller need not be online to quote. They must
be online to release their key, which is the consent step anyway. For MOCK mode, step 2 is a mock certificate and
every later artifact says MOCK (I12).

---

## 7. Inside the worker

```mermaid
flowchart TB
    IN["HTTP 8080<br/>ECIES envelope, ts + nonce replay check"] --> AUTH{"signer is manifest<br/>buyer or seller?"}
    AUTH -- "no" --> DROP["reject"]
    AUTH -- "yes" --> KS["Key slots<br/>seller · buyer · router key"]
    KS --> LOAD["Download + GCM verify<br/>asset, dataset (I10)"]
    LOAD --> SPLIT["Seeded split<br/>train 60 · val 20 · holdout 20 (locked)"]
    SPLIT --> LOOP["Customization loop (§8)"]
    LOOP --> GATE{"Policy gate"}
    GATE -- "valid" --> EXE["Executor: render template,<br/>call Router, parse label"]
    GATE -- "invalid" --> EV["timeline: policy_reject"]
    EXE --> MET["Deterministic metrics"]
    MET --> LOOP
    LOOP -- "finish" --> HO["Holdout eval once (I6)"]
    HO --> OUT["Encrypted report + timeline → 0G Storage<br/>WorkerReceipt + SubmitAuthorization"]
    OUT --> SERVE["/v1/infer for license window<br/>labels only (I7)"]
```

**Why:** one narrow pipe in and out. Inputs are authenticated and encrypted. Keys live only in memory, and a restart
loses them, which ends the job (fail closed). Outputs are fixed shapes: an encrypted report, a signed receipt, and
labels from the label set.

---

## 8. The customization loop

```mermaid
stateDiagram-v2
    [*] --> Baseline: both keys released, job Funded
    Baseline --> Planning: val metrics of default config
    Planning --> Proposed: propose_recipe (enum values)
    Proposed --> Planning: policy_reject (logged)
    Proposed --> Experiment: run_experiment (≤ 2 total)
    Experiment --> Planning: read_metrics → val metrics
    Planning --> Frozen: finish(selected) or budget exhausted or planner unavailable
    Frozen --> Holdout: unlock holdout, evaluate once
    Holdout --> Reported: encrypted report + receipt
    Reported --> Serving: license window
    Serving --> [*]: calls or hours used up
```

**Why:** this is the loop the review asked to restore: baseline → bounded experiment → validation feedback → next
decision → finish → final holdout. The demo has to show one decision that *changes* because of a validation result
(for example, the agent drops few-shot after k=4 hurts minority classes and tries the other template). Holdout
numbers can't influence selection because the holdout is locked until `Frozen`.

---

## 9. Escrow: roles and states (ERC-8183 reference @142e669)

```mermaid
stateDiagram-v2
    [*] --> Open: buyer createJob(provider=worker, evaluator=seller)
    Open --> Open: worker-signed setBudget + setPayoutReceiver (buyer relays)
    Open --> Funded: buyer fund(expectedToken, expectedBudget)
    Open --> Rejected: buyer reject
    Funded --> Submitted: worker-signed submit(receipt commitment)
    Funded --> Rejected: seller reject (refund)
    Funded --> Expired: claimRefund after expiredAt
    Submitted --> Completed: seller complete → payout to seller
    Submitted --> Rejected: seller reject (refund)
    Submitted --> Expired: claimRefund after expiredAt + 1h grace
    Completed --> [*]
    Rejected --> [*]
    Expired --> [*]
```

**Why:** the contract enforces `evaluator != provider` and lets only the provider set the budget and submit, so the
worker is the provider and the seller the evaluator. The seller can't be paid unless the worker submitted. The buyer
can't refuse to pay after receiving the result. We never use claims, so `PendingClaimExists` can't block a refund.
Admin roles are renounced after setup (pause, `emergencyWithdraw`, and UUPS upgrade all need them).

---

## 10. Settlement and use

```mermaid
sequenceDiagram
    autonumber
    participant W as Worker
    participant ST as 0G Storage
    actor B as Buyer client
    participant E as Escrow
    actor S as Seller client
    W->>ST: encrypted report + timeline
    W-->>B: GET /v1/result → reportRoot, WorkerReceipt, signed SubmitAuthorization
    B->>B: decrypt report, check receipt vs manifest + timeline head (PROTOCOL §9)
    B->>E: relay submitWithAuthorization
    S->>E: complete → seller paid
    loop license window
        B->>W: /v1/infer {text} ECIES + signed
        W-->>B: {label} encrypted to buyer session key
    end
```

**Why:** the deliverable is usable: the customized classifier is served from the sealed worker for the license
window, so neither side ever sees the combined config in plaintext. Fixed fee, no uplift pricing (the review
pointed out an unvalidated metric shouldn't drive money).

---

## 11. Data at rest

```mermaid
flowchart LR
    PT["plaintext object"] --> H["header {schema, type, id, version, sha256}"]
    K["fresh random 32-byte key"] --> G["AES-256-GCM<br/>aad = header"]
    PT --> G
    H --> G
    G --> BLOB["blob = len, header, nonce, ciphertext+tag"] --> UP["0G Storage upload<br/>SDK crypto off"]
    K --> KS["local keystore<br/>encrypted by master key"]
    MK["random master key"] --> KS
    PW["passphrase"] --> SC["scrypt"] --> RF["recovery file<br/>AES-GCM(master key)"]
    MK --> RF
```

**Why:** random keys, not a wallet-signature-derived secret (signatures are shareable, and recovery across wallet
types isn't guaranteed: review R08). Recovery = file + passphrase, which works on a fresh device with nothing from
us. GCM plus header-bound AAD makes tampering, truncation or a swapped object fail closed.

---

## 12. Trust boundaries: who sees plaintext

```mermaid
flowchart TB
    subgraph T1["Inside the attested worker"]
        A1["seller bundle"] --- A2["buyer dataset"] --- A3["selected config"]
    end
    subgraph T2["Explicitly trusted and disclosed"]
        B1["0G Router gateway (in memory, zero retention)<br/>+ TeeML provider: rendered prompts, labels"]
        B2["Sandbox provider app: creates the container key"]
    end
    subgraph T3["Own data only"]
        C1["Seller: own bundle, job status, payout"]
        C2["Buyer: own data, report, labels"]
    end
    subgraph T4["Public"]
        D1["chain: job with salted manifest hash"]
        D2["Arkiv: listings, buyer-reported scores"]
        D3["Storage: ciphertext only"]
    end
    T1 -- "per inference call" --> B1
```

**Why:** the review asked us to name every plaintext recipient (R02). The complete list is in SECURITY §3. The two
trusted third parties are 0G's own TEE-backed services, and we say so instead of hiding them.

---

## 13. Runtime routes and gate G-RT

```mermaid
flowchart TB
    START["Same worker image + same client verifier interface"] --> Q1{"0G registers our image<br/>as a sealed snapshot?"}
    Q1 -- "yes" --> W1["W1 sealed sandbox<br/>verify v3 certificate + TappRegistry"]
    Q1 -- "no" --> Q2{"Cloud TDX VM<br/>budget approved?"}
    Q2 -- "yes" --> W2["W2 0G-TAPP<br/>verify DCAP quote + runtime_data"]
    Q2 -- "no" --> W4["W4 MOCK only<br/>synthetic data, loud labels"]
    W1 & W2 --> GRT{"G-RT tests pass?<br/>wrong image, stale evidence,<br/>swapped key, replay all fail"}
    GRT -- "yes" --> CONF["Confidential mode enabled"]
    GRT -- "no" --> W4
```

**Why:** the review said not to assume a runtime works until it's shown. The worker and verifier are built once
against an interface with three implementations, so we can demo the full product in MOCK while the real runtime is
being proven, and switch without rewriting anything.

---

## 14. Arkiv catalog

```mermaid
erDiagram
    LISTING {
        u64 chainId
        addr escrow
        addr seller "indexed"
        key assetId "indexed"
        u64 assetVersion
        str executor "indexed"
        str category "indexed"
        str title "max 128 bytes"
        u256 price
        addr token
        key offerHash
        str offerRoot
        u64 validUntil
    }
    SCORE {
        key listingKey "indexed"
        u64 assetVersion
        addr buyer
        u256 jobId
        dec holdoutMacroF1 "indexed"
        str manifestRoot
        str receiptRoot
    }
    LISTING ||--o{ SCORE : "buyer-reported"
```

**Why:** public, expiring, wallet-owned data is what Arkiv is for, and the browse page is the user-visible read the
track requires. Bare IDs aren't unique, so every listing carries chain, escrow, asset ID and version (R16). Scores are
always "buyer-reported". The "worker-signed" badge needs a completed job and a receipt that verifies (PROTOCOL §10).

---

## 15. CROPS: what still depends on whom

```mermaid
flowchart LR
    APP["Static client built from the repo<br/>(no server of ours)"] --> RPC["0G RPC: swappable"]
    APP --> IDX["0G Storage indexer: swappable"]
    APP --> AKR["Arkiv RPC + own key: swappable"]
    APP --> RT["0G Router: required for planner + executor"]
    APP --> SP["Sandbox provider: required for confidential mode"]
    APP --> ESC["Escrow contract: immutable after renounce"]
    RPC -. "outage" .-> F1["switch endpoint"]
    RT -. "outage" .-> F2["run stops, refund after expiry"]
    SP -. "outage" .-> F3["no new jobs; MOCK still demoable"]
```

**Why:** CROPS judges reward structural independence and honest trade-offs. We claim independence from *us*, not
from 0G. Refunds work with only an RPC and the contract, so a buyer can always recover funds without any service of
ours (R15).

---

## 16. Build order and gates

```mermaid
flowchart LR
    T00["T00 scope approved"] --> T01["T01 runtime + dependency evidence"]
    T00 --> T02A["T02A planner + policy<br/>on fixtures (MOCK)"]
    T00 --> T03["T03 escrow tests<br/>+ deploy + renounce"]
    T00 --> T06["T06 envelope + vault"]
    T01 --> T02["T02 G-RT: real sealed worker"]
    T04 --> T02
    T02A --> T02B["T02B loop: baseline → 2 exp → holdout"]
    T03 --> T04["T04 worker auth, release, replay"]
    T06 --> T04
    T02B --> T04
    T04 --> T05["T05 receipts + acceptance policy"]
    T05 --> T07["T07 Arkiv"]
    T05 --> T08["T08 Router strict tier"]
    T07 & T08 --> T09["T09 full CLI run"]
    T09 --> T10["T10 web app + CROPS demo"]
    T10 --> T11["T11 submission"]
    T02 -. "enables confidential label" .-> T09
```

**Why:** the planner, escrow and envelope work don't depend on the runtime, so they proceed in parallel with the
G-RT investigation. The submission depends only on MVP tasks. Confidential mode is a label that switches on when T02
passes, not a blocker for shipping the product loop.
