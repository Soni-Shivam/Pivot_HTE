# Architecture (working name SealedAI, placeholder)

Diagrams for `docs/PLAN.md`. Each section has one diagram and a few words on why it's built that way. Facts come
from the sources listed in PLAN.md; anything not yet confirmed on testnet is marked **VERIFY** and tracked in
`docs/TASKS.md`.

Legend used throughout:
- **Ours**: code we write (kept as small as possible).
- **Reused**: published, maintained components used unchanged.
- **External**: networks and services we call but don't run.

---

## 1. System map

```mermaid
flowchart LR
    subgraph USER["User's device (ours, open source, no backend)"]
        APP["Static web app<br/>Vite + viem"]
        CLI["CLI<br/>same core package"]
        CORE["packages/core<br/>escrow · vault · grader · proofs · arkiv"]
        WALLET["User wallet<br/>signs everything"]
        APP --> CORE
        CLI --> CORE
        CORE --> WALLET
    end

    subgraph ARKIV["Arkiv Rabdi testnet (external)"]
        LIST[("listing entities")]
        SCORE[("score entities")]
    end

    subgraph ZG["0G (external)"]
        direction TB
        subgraph CHAIN["0G Chain Galileo 16602"]
            ESC["ERC-8183 escrow<br/>reused, admin renounced"]
            AID["AgenticID ERC-7857 + ERC-8004<br/>reused, deployed by 0G"]
            VFR["VerifiedFeedbackRegistry<br/>reused, deployed by 0G"]
        end
        STORE[("0G Storage<br/>encrypted blobs")]
        ROUTER["0G Private Computer Router<br/>private trust mode"]
        subgraph TEE["AgentDNA sealed sandbox, Intel TDX (reused)"]
            AGENT["Seller's sealed agent<br/>/api/* with serve-proofs"]
        end
    end

    CORE -- "browse, publish" --> ARKIV
    CORE -- "jobs, payments, refunds" --> ESC
    CORE -- "deploy, clone, feedback" --> AID
    CORE -- "feedback with proof" --> VFR
    CORE -- "encrypted benchmark, report" --> STORE
    CORE -- "grade, summarise" --> ROUTER
    CORE -- "paid calls" --> AGENT
    AGENT -- "reads job state" --> ESC
    AGENT -- "iData ciphertext" --> STORE
    AGENT -- "identity, iData version" --> AID
```

**Why this shape:** every box outside "User's device" already exists and is run by someone else. Our code is a
client plus one small seller service. There's no server of ours in the picture: nothing to breach, nothing that sees
keys, and nothing whose shutdown stops the app (the CROPS lead property). The sealed agent is the only place both
parties' data meet, and it runs on AgentDNA's real TDX hardware rather than a worker we'd have to build and could
only mock here.

---

## 2. Who builds what

```mermaid
flowchart TB
    subgraph REUSED["Reused unchanged"]
        R1["AgentDNA SDK + sealed runtime<br/>@0gfoundation/0g-agentdna 0.4.0"]
        R2["ERC-8183 reference contracts<br/>erc-8183/base-contracts, MIT"]
        R3["0G Storage SDK, aes256 mode"]
        R4["0G Router, OpenAI-compatible"]
        R5["Arkiv SDK 1.0.1"]
        R6["MockUSDC test token<br/>from the ERC-8183 repo"]
    end
    subgraph OURS["Ours"]
        O1["packages/core<br/>thin wrappers + rules"]
        O2["Seller service template<br/>payment check + answer"]
        O3["Static web app + CLI"]
        O4["Deploy script<br/>deploy, allow token, renounce admin"]
        O5["PurchaseCloneAuthorizer<br/>about 40 lines, Phase 5, only if G2 holds"]
    end
    O1 --> R1 & R3 & R4 & R5
    O2 --> R1
    O4 --> R2 & R6
    O5 --> R1 & R2
    O3 --> O1
```

**Why:** the brief is to reuse first. The custom code is glue and policy. Anything security-critical (TEE key
handling, attestation, escrow accounting, proof signing) stays in components that are already deployed, tested and
reviewed by their maintainers.

---

## 3. Seller's agent on AgentDNA

```mermaid
flowchart LR
    S["Seller wallet"] -- "1 ack trust root<br/>2 deposit sandbox balance" --> SB["Sandbox billing contracts"]
    S -- "3 deploy, no sandbox<br/>signed iData: framework + persona" --> ATT["AgentDNA attestor<br/>agentdna-testnet.0g.ai"]
    ATT -- "encrypt iData" --> ST[("0G Storage")]
    ATT -- "mint ERC-7857 token" --> AID["AgenticID"]
    S -- "4 start, model key sealed<br/>to the agent key" --> ATT
    ATT -- "provision container" --> C
    subgraph C["Sealed container, Intel TDX"]
        SEALED["sealed runtime<br/>holds agent_seal_priv in memory only"]
        FW["openclaw framework<br/>persona, skills"]
        SVC["seller /api/answer service<br/>loopback, registered with sealed"]
        SEALED --> FW
        FW --> SVC
    end
    SVC -. "inference" .-> R["0G Router"]
```

**Why:** the seller's IP (persona, skills, service code) becomes ERC-7857 iData: encrypted on 0G Storage, with the
key sealed so only the agent's TEE can open it. Deploying *without* a sandbox and then calling `start` keeps the
model API key out of the wallet prompt (SDK guide). We pick `openclaw` because it's the default framework with
documented service registration.

**VERIFY (gate G1):** that a seller can ship deterministic service code, either by asking the agent to create it
(the documented "expose a service" path) or by seeding it through the `workspace/` iData role.

---

## 4. Key trust chain inside AgentDNA (reused; what we rely on)

```mermaid
sequenceDiagram
    autonumber
    participant KMS as AgentDNA KMS (TEE app)
    participant ATT as Attestor (TEE app)
    participant SP as Sandbox provider
    participant C as Sealed container (TDX)
    participant REG as TappRegistry (0G Chain)
    REG-->>ATT: registered app identities
    SP->>C: inject container key, issue signed certificate
    C->>ATT: provision request with certificate
    ATT->>ATT: check certificate is signed by a trusted provider
    KMS->>ATT: derive per-agent agent_seal_priv
    ATT->>C: ECIES(agent_seal_priv, container pubkey)
    C->>C: decrypt into memory, zero the env copy
    Note over C: owner, host and attestor never see agent_seal_priv after this
```

**Why it matters to us:** this chain is our "only approved code gets the keys" guarantee. We don't reimplement it.
We state its assumptions instead: the attestor, KMS and sandbox provider are the acknowledged trust root (`ag.ack()`),
plus Intel TDX and the TappRegistry. Source: `sealed/TRUST_MODEL.md` in `0gfoundation/0g-agentic-id`.

---

## 5. Pay-per-call test drive

```mermaid
sequenceDiagram
    autonumber
    actor B as Buyer client
    participant E as ERC-8183 escrow
    participant A as Seller agent /api/answer (TEE)
    B->>E: createJob(provider=seller, evaluator=buyer, expiredAt, desc, hook=0, agentId)
    B->>E: setBudget(N x price), approve token, fund
    loop for each test case k = 1..N
        B->>E: settleClaim(jobId, k x price, keccak(request), 0x)
        E-->>A: seller paid for call k
        B->>A: POST case k + EIP-191 sig over (APP_ID, jobId, k, sha256(body))
        A->>E: getJob(jobId)
        A->>A: check Funded, signer == client, settledAmount >= k x price
        A-->>B: answer + X-Agent-Proof
    end
    Note over B,E: after expiredAt, anyone calls claimRefund and the unsettled budget returns to the buyer
```

**Why:** paying *before* each call caps both sides' risk at one call. No evaluator has to be trusted, and the buyer
can't use the service and then refuse to pay. `settleClaim` and `claimRefund` are already in the reference contract,
and `claimRefund` can't be blocked by hooks. Fixed per-call prices follow the review advice: no outcome-based
pricing until benchmark integrity is proven.

---

## 6. Escrow state machine (reference ERC-8183, unchanged)

```mermaid
stateDiagram-v2
    [*] --> Open: createJob
    Open --> Funded: setBudget + fund
    Open --> Rejected: client reject
    Funded --> Funded: settleClaim (pay per call)
    Funded --> Submitted: provider submit
    Funded --> Rejected: evaluator reject
    Funded --> Expired: claimRefund after expiry
    Submitted --> Completed: evaluator complete
    Submitted --> Rejected: evaluator reject
    Submitted --> Expired: claimRefund after expiry + 1h grace
    Completed --> [*]
    Rejected --> [*]
    Expired --> [*]
```

**Why:** we only use the `Funded → Funded` streaming loop plus `Expired` for test drives. `Completed` is used later
by the "buy" flow. After setup, the deploy script renounces the admin roles (pause, `emergencyWithdraw`, upgrade), so
we can't touch escrowed funds. A test proves it.

---

## 7. Proofs, report and feedback

```mermaid
flowchart LR
    RESP["answer + X-Agent-Proof"] --> V{"verifyProof(proof, task)"}
    V -- "ok: signer = agentSeal,<br/>not expired, data on chain,<br/>task bound to these bytes" --> KEEP["keep case result"]
    V -- "fail" --> DROP["mark case UNVERIFIED<br/>never scored"]
    KEEP --> G["grader score<br/>with request ID"]
    G --> REP["report JSON<br/>case hashes, answers, proofs,<br/>scores, request IDs"]
    REP --> ENC["aes256 encrypt"] --> ST[("0G Storage root")]
    REP -- "buyer opts in" --> FB["giveFeedback(agentId, value, serveProof)"]
    FB --> CANON["ERC-8004 Reputation<br/>canonical entry"]
    FB --> VER["VerifiedFeedbackRegistry<br/>proof-backed mark"]
    REP -- "buyer opts in" --> AS[("Arkiv score entity")]
```

**Why:** a serve-proof proves *which* agent, in *which* iData version, produced *these exact bytes*. It does not
prove the answer is right; that's the grader's job, and the report keeps the two apart. Feedback must carry a proof
the buyer earned, and only that buyer can redeem it, so fake reviews cost real paid calls.

---

## 8. Benchmark vault

```mermaid
flowchart LR
    W["Buyer wallet"] -- "sign fixed message<br/>APP_ID vault v1" --> SIG["signature"]
    SIG -- "sha256" --> K["32-byte vault key"]
    CASES["test cases JSON"] --> UP["0G Storage upload<br/>encryption aes256 with K"]
    K --> UP
    UP --> ROOT["root hash<br/>kept locally + recovery file"]
    ROOT --> DL["downloadToBlob<br/>decryption with K"]
    K --> DL
    DL --> CHECK{"sha256 matches<br/>recorded hash?"}
    CHECK -- "yes" --> USE["use cases"]
    CHECK -- "no" --> ERR["wrong key: stop<br/>the SDK returns ciphertext silently"]
```

**Why:** the buyer can always recover the vault key from their wallet alone, with nothing from us (CROPS: recoverable
without a server). The hash check exists because the 0G SDK returns ciphertext instead of an error when the key is
wrong (seen in `examples/02`). **VERIFY:** that the wallets we target sign deterministically (RFC 6979); if one
doesn't, we fall back to a key file.

---

## 9. Grader on 0G Private Computer

```mermaid
sequenceDiagram
    autonumber
    participant B as Buyer client
    participant R as 0G Router
    participant P as TeeML provider (TDX)
    B->>R: POST /v1/chat/completions<br/>X-0G-Provider-Trust-Mode: private<br/>model 0gm-1.0-35b-a3b, json_object, thinking off
    R->>P: route to a TEE-attested provider
    P-->>R: score + reason JSON
    R-->>B: body + X-Request-ID + x_0g_trace
    B->>B: store request ID per case, show it in the report
    alt no TEE provider available
        R-->>B: 503 no_provider_for_trust_mode
        B->>B: stop and say so, never fall back to non-private
    end
```

**Why:** this puts 0G Private Computer inference in the main user flow with visible request IDs, which the 0G track
requires. AI is the product here: it turns a raw benchmark into a judgement and a plain-English summary. Limit,
disclosed in the UI: 0G's gateway sees prompts in plaintext ("tier 2.5"). Buyers can pick local exact-match grading
instead.

---

## 10. Arkiv catalog

```mermaid
erDiagram
    LISTING {
        u256 agentId "indexed"
        str category "indexed"
        str title "up to 128 bytes"
        u256 pricePerCall
        addr token
        addr escrow
    }
    SCORE {
        u256 agentId "indexed"
        dec score "indexed, sortable"
        u64 cases
        str reportRoot "0G Storage root"
        u256 jobId
    }
    LISTING ||--o{ SCORE : "rated by buyers"
```

```mermaid
flowchart LR
    Q["Browse page"] --> F["select from sealedai.listing<br/>where category = X"]
    F --> T{"$creator == ownerOf(agentId)<br/>on 0G Chain?"}
    T -- "yes" --> SHOW["show listing<br/>+ scores sorted desc"]
    T -- "no" --> HIDE["hide: spoofed listing"]
```

**Why:** listings and opt-in scores are public by nature, and expire on their own (Arkiv expiration), so the catalog
needs no database of ours. Arkiv is a public database anyone can write to, so we only trust a listing written by the
agent's on-chain owner (Arkiv docs: filter by creator). Private state (jobs in progress, vault roots) never goes to
Arkiv. The browse page is the user-visible Arkiv read the track requires. Column types are from Arkiv's documented set;
exact builder syntax is confirmed in T1.6.

---

## 11. Buy flow (Phase 5, shape decided by gate G2)

```mermaid
sequenceDiagram
    autonumber
    actor S as Seller
    actor B as Buyer
    participant E as ERC-8183 escrow
    participant CG as CloneGate (0G)
    participant PA as PurchaseCloneAuthorizer (ours)
    participant ATT as AgentDNA attestor
    S->>CG: setCloneAuthorizer(agentId, PA)
    B->>E: purchase job: fund, seller submits, buyer completes
    B->>ATT: clone(sourceAgentId, targetOwner=B, authData=jobId)
    ATT->>CG: cloneFrom(...)
    CG->>PA: canClone(source, B, B, jobId)
    PA->>E: getJob(jobId): Completed, client == B, agentId == source
    PA-->>CG: true
    CG-->>B: new ERC-7857 token, iData re-keyed to the buyer's copy
```

**Why:** 0G already built the marketplace-fork path (`ICloneAuthorizer`, issue #133). Our only contract is the
policy: "yes iff this buyer completed a purchase job for this agent". **Gate G2** checks first whether a buyer who owns
a copy can simply ask it for the seller's prompt. If they can, we sell ongoing hosted access instead (the flow in §5
with a long-lived job) and don't ship this.

---

## 12. Trust boundaries: who can see what

```mermaid
flowchart TB
    subgraph PUBLIC["Public"]
        P1["listings, scores"]
        P2["jobs, payments"]
        P3["agent identity, iData version hashes"]
    end
    subgraph BUYER["Buyer only"]
        B1["benchmark cases at rest"]
        B2["full report"]
    end
    subgraph TEEONLY["Agent's TEE only"]
        T1["seller persona, skills, service code"]
        T2["agent signing key"]
    end
    subgraph LEAKY["Seen by a third party, disclosed"]
        L1["each test case, by the seller's agent<br/>and its owner via private chat"]
        L2["grader prompts, by 0G's gateway"]
        L3["wallet address, by RPC providers"]
    end
```

**Why:** stating this up front is how we keep claims honest. The three items in the bottom box are known limits
(PLAN §5). L1 is the biggest one, and it's on the roadmap ("test drive on a clone neither party owns").

---

## 13. CROPS: running without us

```mermaid
flowchart LR
    REPO["Public repo, MIT"] -- "npm ci, npm run build" --> DIST["dist/ static files"]
    DIST --> LOCAL["run locally"]
    DIST --> ANYHOST["any static host or IPFS"]
    LOCAL & ANYHOST --> SET["Settings: user-editable endpoints"]
    SET --> E1["0G RPC"]
    SET --> E2["0G Storage indexer"]
    SET --> E3["Arkiv RPC + own key"]
    SET --> E4["0G Router + own key"]
    SET --> E5["agent URL from chain"]
    CLI2["Official 0g-agentdna CLI"] -. "independent client<br/>for agents and feedback" .-> E1
```

**Why:** the lead property is censorship resistance, and here it's structural. There's no backend to switch off,
and every endpoint can be swapped. The demo builds from a fresh clone, swaps RPCs, and completes a test drive. The
official AgentDNA CLI is a second, independent client that 0G maintains, so users don't even need our UI to verify an
agent or leave feedback. Stretch: publish the `dist/` hash so anyone can check the hosted copy matches the repo.

---

## 14. Build order and gates

```mermaid
flowchart LR
    P0["P0 Freeze<br/>plan approved"] --> P1["P1 Prove reuse<br/>spikes on testnet"]
    P1 --> G1{"G1: seller service<br/>+ serve-proof?"}
    P1 --> G2{"G2: clone leaks<br/>seller prompt?"}
    G1 -- "pass" --> P2["P2 Contracts<br/>deploy, renounce"]
    G1 -- "fail" --> ASK["ask 0G: seed service<br/>via workspace iData"]
    P2 --> P3["P3 Full transaction<br/>CLI, all evidence IDs"]
    P3 --> P4["P4 Web app + CROPS<br/>+ Arkiv files"]
    P4 --> CUT(["hackathon cut line"])
    G2 -- "holds" --> P5A["P5 sell a copy"]
    G2 -- "leaks" --> P5B["P5 sell hosted access"]
    CUT --> P5A & P5B
    P5A & P5B --> P6["P6 stretch: agent pays itself,<br/>0G sign-in, build hash"]
    P6 --> P7["P7 submit"]
```

**Why:** we prove each borrowed piece on testnet before building on it. G1 is the one gate that could change the
architecture, so it runs first. Phases 1 to 4 are a complete submission; everything after the cut line is a bonus.
