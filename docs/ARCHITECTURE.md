# Architecture (revision 3)

Diagrams for `docs/PLAN.md`. Formats: `docs/PROTOCOL.md`. Rules: `docs/SECURITY.md` (invariants I1–I12). Each
section has one diagram and a few words on why. Legend: **ours** = code we write · **reused** = published component,
unchanged · **external** = a service we call.

---

## 1. System map

```mermaid
flowchart LR
    subgraph DEV["User devices (ours, open source, no backend)"]
        SC["Seller client"]
        BC["Buyer client"]
    end

    subgraph TEE["Sealed worker: our image on TEE hardware (TDX + H100 CC)"]
        API["Control plane (TS)<br/>ECIES API, keys, receipts"]
        GATE["Policy gate"]
        PLAN["Customization agent loop"]
        ML["ML plane (Python)<br/>load · train LoRA · eval · serve"]
        API --> GATE
        GATE <--> PLAN
        GATE --> ML
    end

    subgraph ZG["0G (external)"]
        CHAIN["0G Chain<br/>ERC-8183 escrow · TappRegistry"]
        STORE[("0G Storage<br/>sealed model, data, report")]
        ROUTER["0G Private Computer<br/>private tier"]
    end
    ARKIV[("Arkiv<br/>listings, buyer-reported scores")]

    SC -- "sealed model bundle" --> STORE
    BC -- "sealed dataset" --> STORE
    SC -- "listing" --> ARKIV
    BC -- "browse" --> ARKIV
    SC & BC -- "verify evidence, release key (2-of-2)" --> API
    BC -- "job, fund, relay worker sigs" --> CHAIN
    SC -- "complete, get paid" --> CHAIN
    ML -- "ciphertext in" --> STORE
    API -- "sealed report out" --> STORE
    PLAN -- "aggregates only" --> ROUTER
```

**Why:** the seller's weights and the buyer's rows meet only in the box labelled TEE, and nothing in that box sends
either one anywhere. The only line to the 0G Router carries aggregate numbers and the public model card (D10). That
fixes rev 2, where every classifier call carried assets through the Router gateway. We run no server; clients talk
to 0G and Arkiv directly.

---

## 2. Roles and authority

```mermaid
flowchart TB
    subgraph PROPOSE["Can only propose"]
        LLM["Agent LLM on 0G Private Computer<br/>sees card, goal, summary, aggregates"]
    end
    subgraph DECIDE["Decides: deterministic code in the enclave"]
        G["Policy gate<br/>catalog enums · 2 training runs max<br/>GPU-seconds · time · holdout lock"]
    end
    subgraph CONSENT["Consent: the parties' wallets"]
        S["Seller: Offer + model key release"]
        B["Buyer: plan approval + manifest + data key release + funding"]
    end
    LLM -- "tool call JSON" --> G
    G -- "accepted or rejected, logged" --> LLM
    S --> G
    B --> G
    G -. "never" .-> NO["shell · network · files · signing · spending · key release"]
```

**Why:** the agent decides *how to train*, which is the product. Authority stays with code and the two wallets (I5).

---

## 3. Who builds what

```mermaid
flowchart LR
    subgraph REUSED["Reused unchanged (pinned)"]
        R1["0G-TAPP / sealed sandbox"]
        R2["ERC-8183 + WithAuthorization"]
        R3["0G Storage SDK, crypto off"]
        R4["0G Router"]
        R5["Arkiv SDK"]
        R6["PyTorch, transformers, peft, safetensors"]
        R7["dcap-qvl, NVIDIA GPU verifier,<br/>noble, eciesjs"]
    end
    subgraph OURS["Ours"]
        P["packages/protocol"]
        PL["packages/planner"]
        CL["packages/client"]
        W["packages/worker (control plane)"]
        M["worker/ml (ML plane)"]
        IM["worker/image (one digest)"]
        I["packages/integrations"]
        A["apps/cli, apps/web"]
        C["contracts: deploy, renounce, tests"]
    end
    P --> PL & CL & W
    W --> PL & I & M
    M --> R6
    CL --> R7
    W --> R7
    I --> R3 & R4 & R5
    C --> R2
    IM --> W & M
    IM -. "runs on" .-> R1
    A --> CL
```

**Why:** TEE isolation, attestation, escrow accounting, ciphers and the ML frameworks are reused. What we write is
the protocol, the policy gate, a safe model loader, and the training/eval/serve wrapper.

---

## 4. Seller lists a model

```mermaid
sequenceDiagram
    autonumber
    actor S as Seller client
    participant ST as 0G Storage
    participant AK as Arkiv
    S->>S: check bundle: safetensors + config + tokenizer + card, allowlisted architecture
    S->>S: deterministic tar → 64 MiB chunks → AES-GCM per chunk (fresh key K_m)
    S->>ST: upload chunks + sealed chunk manifest (SDK crypto off)
    ST-->>S: assetRoot
    S->>S: sign Offer {assetCommitment, format, task, architecture, recipe catalog, workerImageDigest, evidencePolicy, price, license}
    S->>ST: upload signed Offer JSON → offerRoot
    S->>AK: listing/v1 {offerHash, offerRoot, task, architecture, parameters, price} expires at validUntil
    S->>S: K_m stays in the local keystore (recovery file)
```

**Why:** the seller pins the exact worker image and the evidence policy (for example "TDX + H100 CC required") in a
signed Offer, so their key can only ever go to that code on that class of hardware. B1 (standard formats) means no
seller code ever runs (I4).

---

## 5. Goal → plan

```mermaid
sequenceDiagram
    autonumber
    actor B as Buyer client
    participant AK as Arkiv
    participant R as 0G Router (private)
    B->>AK: query listings by task
    B->>B: verify Offer sig, creator == seller, validity
    B->>B: numeric summary of own data: rows, label histogram, token-length p50/p95
    B->>R: goal text + public card + summary + recipe catalog
    R-->>B: proposed plan JSON + X-Request-ID
    B->>B: policy check of the plan, buyer approves → planHash, goalCommitment
```

**Why:** the buyer sees and approves the plan before anything is unlocked. Only numbers and the goal text the buyer
wrote leave the device, and only to 0G's private tier.

---

## 6. Worker boot, verification and 2-of-2 release

```mermaid
sequenceDiagram
    autonumber
    actor B as Buyer client
    actor S as Seller client
    participant VM as TEE host (TAPP on TDX + H100)
    participant W as Worker (in enclave)
    participant E as ERC-8183 escrow
    B->>VM: start worker app (compose pins workerImageDigest)
    VM->>W: boot, measure, derive app signer + job key
    B->>W: GET /v1/identity, POST /v1/challenge(nonce_b)
    B->>B: verify TDX quote, runtime_data, image, GPU reports (NVIDIA), signed nonce
    B->>E: createJob(provider=W, evaluator=S, expiry, "sealedai:v1:"+manifestHash, hook=0)
    B->>W: POST /v1/manifest (manifest + Offer + sigs)
    W-->>B: signed setBudget(price) + setPayoutReceiver(S)
    B->>E: relay both, fund(expectedToken, expectedBudget)
    S->>W: challenge(nonce_s) → fresh evidence
    S->>S: verify independently + manifest vs own Offer + job Funded on chain
    S->>W: KeyRelease(model) ECIES to worker key
    B->>W: KeyRelease(dataset) + Router key
    W->>W: proceed only with both valid releases for this manifestHash
```

**Why:** the buyer deploys the worker but can't reach inside it (TAPP's "malicious deployer" model), and the seller
re-verifies everything with its own nonce instead of trusting the buyer. No valid CPU + GPU evidence means no key
leaves either client. There's no mock path (I12).

---

## 7. Inside the worker

```mermaid
flowchart TB
    IN["HTTP 8080: ECIES, signature, ts + nonce"] --> AUTH{"signer = manifest<br/>buyer or seller?"}
    AUTH -- "no" --> DROP["reject"]
    AUTH -- "yes" --> KS["Memory-only key slots<br/>model · dataset · router"]
    KS --> LOAD["Download, GCM verify, untar"]
    LOAD --> SAFE{"Safe loader: allowlisted arch,<br/>safetensors only, no remote code"}
    SAFE -- "fail" --> ABORT["abort job"]
    SAFE -- "ok" --> SPLIT["Seeded split<br/>train 60 · val 20 · holdout 20 (locked)"]
    SPLIT --> LOOP["Agent loop (§8)"]
    LOOP --> GATE{"Policy gate"}
    GATE -- "valid" --> TRAIN["Train LoRA / head on GPU<br/>metered GPU-seconds"]
    GATE -- "invalid" --> EV["timeline: policy_reject"]
    TRAIN --> EVAL["Eval on val → aggregates"]
    EVAL --> LOOP
    LOOP -- "finish" --> HO["Holdout eval once (I6)"]
    HO --> OUT["Sealed report + timeline → 0G Storage<br/>WorkerReceipt + SubmitAuthorization"]
    OUT --> SERVE["/v1/infer: labels only (I7)<br/>/v1/adapter only if Offer allows (C2)"]
```

**Why:** the control plane (TS) owns keys, protocol and policy. The ML plane (Python) only computes and talks to the
control plane over a local pipe, with no network of its own. Keys are memory-only, so a crash ends the job (fail
closed).

---

## 8. The customization loop (real training)

```mermaid
stateDiagram-v2
    [*] --> Baseline: both keys released, job Funded
    Baseline --> Planning: val metrics of the seller model as-is
    Planning --> Proposed: propose_recipe (LoRA or head_only, enum values)
    Proposed --> Planning: policy_reject (logged)
    Proposed --> Training: run_training (max 2)
    Training --> Planning: read_metrics → trainLoss, valLoss, valF1
    Planning --> Frozen: finish, budget exhausted, or planner unavailable
    Frozen --> Holdout: unlock holdout, evaluate once
    Holdout --> Reported: sealed report + receipt
    Reported --> Serving: license window
    Serving --> [*]: calls or hours used up
```

**Why:** baseline → bounded training → validation feedback → next decision → finish → final holdout, the loop the
review asked for, now with real weight updates. The demo has to show one decision changing because of a validation
result: for example, run 1 (LoRA r=16, lr 2e-4) overfits (train loss down, val F1 down), so the agent switches to
r=8, lr 5e-5 with balanced class weights.

---

## 9. Escrow roles and states (ERC-8183 @142e669, unchanged)

```mermaid
stateDiagram-v2
    [*] --> Open: buyer createJob(provider=worker, evaluator=seller)
    Open --> Open: worker-signed setBudget + setPayoutReceiver (buyer relays)
    Open --> Funded: buyer fund(expectedToken, expectedBudget)
    Open --> Rejected: buyer reject
    Funded --> Submitted: worker-signed submit(receipt commitment)
    Funded --> Rejected: seller reject → refund
    Funded --> Expired: claimRefund after expiredAt
    Submitted --> Completed: seller complete → payout to seller
    Submitted --> Rejected: seller reject → refund
    Submitted --> Expired: claimRefund after expiredAt + 1h grace
    Completed --> [*]
    Rejected --> [*]
    Expired --> [*]
```

**Why:** the contract requires `evaluator != provider`, and only the provider can budget and submit. So the attested
worker is the provider and the seller the evaluator: the seller can't be paid without a worker submission, and the
buyer can't withhold payment after receiving the result. No claims are used; admin roles are renounced.

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
    W->>ST: sealed report + timeline
    W-->>B: /v1/result → reportRoot, WorkerReceipt, signed SubmitAuthorization
    B->>B: decrypt, check receipt vs manifest + timeline head + evidence
    B->>E: relay submitWithAuthorization
    S->>E: complete → seller paid
    loop license window
        B->>W: /v1/infer {text} (ECIES, signed)
        W-->>B: {label} encrypted to buyer
    end
    opt Offer allows adapter export (C2)
        B->>W: /v1/adapter
        W-->>B: LoRA adapter sealed to buyer
    end
```

**Why:** the default deliverable (C1) is the customized model served from the enclave, so nobody ever holds the
combined weights. C2 hands the buyer the adapter they paid to train, but it's only useful with a licensed base model.

---

## 11. Data at rest

```mermaid
flowchart LR
    PT["object (model tar chunk, dataset, report)"] --> H["header {schema, type, id, version, sha256}"]
    K["fresh random 32-byte key"] --> G["AES-256-GCM, aad = header"]
    PT --> G
    H --> G
    G --> BLOB["len, header, nonce, ciphertext+tag"] --> UP["0G Storage, SDK crypto off"]
    K --> KS["local keystore (master key)"]
    PW["passphrase"] --> SC["scrypt"] --> RF["recovery file"]
    KS --> RF
```

**Why:** authenticated encryption with header-bound AAD makes tampering, truncation or object swaps fail closed (the
SDK's own mode is unauthenticated AES-CTR). Random keys plus a passphrase recovery file restore everything on a fresh
device without us (R08).

---

## 12. Trust boundaries: who sees plaintext

```mermaid
flowchart TB
    subgraph T1["Inside the verified enclave (CPU TDX + GPU CC)"]
        A1["seller weights"] --- A2["buyer rows"] --- A3["customized model"]
    end
    subgraph T2["0G private tier: aggregates only"]
        B1["public card · goal text · data summary · rounded metrics"]
    end
    subgraph T3["Own data only"]
        C1["Seller: own model, job status, payout"]
        C2["Buyer: own data, report, infer outputs"]
    end
    subgraph T4["Public"]
        D1["chain: salted manifest hash, payments"]
        D2["Arkiv: listings, buyer-reported scores"]
        D3["Storage: ciphertext"]
    end
    T1 -- "numbers only" --> T2
```

**Why:** the user's rule is that no operator or compute provider can reach either asset on its own authority. The
only thing that leaves the enclave towards a third party is numbers, and the buyer sees every one of them in the
timeline.

---

## 13. Hardware routes and gate G-RT

```mermaid
flowchart TB
    IMG["One worker image digest<br/>pinned in every Offer"] --> Q1{"0G hosts it on a<br/>GPU TEE provider? (H1)"}
    Q1 -- "yes" --> V["Client verifier:<br/>TDX quote + runtime_data + image<br/>+ NVIDIA GPU reports + signed nonce"]
    Q1 -- "no / pending" --> Q2{"GCP a3-highgpu-1g<br/>confidential quota + budget? (H2)"}
    Q2 -- "yes" --> V
    Q2 -- "no" --> Q3{"Phala H100 TEE (H3)?"}
    Q3 -- "yes" --> V
    Q3 -- "no" --> Q4{"Small model on CPU TDX? (H4)"}
    Q4 -- "yes" --> V2["Client verifier:<br/>TDX quote or v3 certificate"]
    Q4 -- "no" --> STOP["No confidential run.<br/>Keys are never released.<br/>Synthetic-data dev tests only."]
    V & V2 --> GRT{"G-RT negative tests fail closed?"}
    GRT -- "yes" --> GO["Confidential jobs enabled"]
```

**Why:** there's no mock mode. Every route ends either in verified evidence or in "no keys released". The worker and
the verifier have one interface with per-runtime evidence checkers, so the route can change without touching the
product. TAPP's GPU build doesn't verify the GPU report signature itself; our client does, against NVIDIA.

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
        str task "indexed"
        str architecture "indexed"
        str title "max 128 bytes"
        u64 parameters
        u256 price
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

**Why:** public, expiring, wallet-owned listings are what Arkiv is for, and the browse page is the user-visible read.
Namespaced IDs avoid collisions (R16); scores carry provenance and stay labelled "buyer-reported" (R12).

---

## 15. CROPS: dependency and failure matrix

```mermaid
flowchart LR
    APP["Static client built from the repo"] --> RPC["0G RPC: swappable"]
    APP --> IDX["0G Storage indexer: swappable"]
    APP --> AKR["Arkiv RPC + own key: swappable"]
    APP --> RT["0G Router: needed by the agent"]
    APP --> HW["TEE host: needed for any job"]
    APP --> ESC["Escrow: immutable after renounce"]
    RT -. "outage" .-> F1["agent stops, best-by-val result"]
    HW -. "outage" .-> F2["no new jobs; refund after expiry"]
    RPC -. "outage" .-> F3["switch endpoint"]
```

**Why:** we claim independence from *us*, not from 0G or the TEE host. Refunds need only an RPC and the contract (R15).

---

## 16. Build order and gates

```mermaid
flowchart LR
    T00["T00 final confirmation"] --> T01["T01 deps + hardware answers"]
    T00 --> T02A["T02A agent + policy<br/>(scripted LLM, synthetic)"]
    T00 --> T03["T03 escrow tests, renounce"]
    T00 --> T06["T06 envelope + vault + ECIES compat"]
    T00 --> T13["T13 ML plane: loader, LoRA, eval<br/>(A5000, synthetic)"]
    T02A --> T02B["T02B full loop on ML plane"]
    T13 --> T02B
    T01 --> T14["T14 evidence verifiers<br/>CPU + GPU"]
    T03 --> T04["T04 worker control plane"]
    T06 --> T04
    T02B --> T04
    T14 --> T02["T02 G-RT on real TEE hardware"]
    T04 --> T02
    T04 --> T05["T05 receipts + acceptance"]
    T05 --> T07["T07 Arkiv"]
    T05 --> T08["T08 Router strict tier"]
    T02 & T07 & T08 --> T09["T09 full CLI run, confidential"]
    T09 --> T10["T10 web app + CROPS"]
    T10 --> T11["T11 submission"]
```

**Why:** everything except T02 and T09 can be built and tested now on this server with synthetic data. The
confidential end-to-end run (T09) depends on real hardware passing G-RT, which is why the hardware request (T01)
starts on day 1.
