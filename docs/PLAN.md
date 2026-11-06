# Project plan (working name: SealedAI — placeholder, not final)

Status: DRAFT for approval · Written 2026-11-06 · Supersedes https://claude.ai/artifact/AXKEPVFc1eDiFvHo6bUMKZ

This is the single source of truth for what we build and why. Agents: read this, then `docs/TASKS.md`, then the
phase plan in `docs/superpowers/plans/`. Every fact below was read from official docs, source code or a live call on
2026-11-06 (sources at the end). Anything not yet verified is marked **VERIFY** and has a task in `docs/TASKS.md`.

The product name is not decided. Code uses one constant `APP_ID = "sealedai"` (schema names, EIP-191 message
prefixes). Renaming = change that constant and the docs.

---

## 1. What we are building

**Long-term:** a marketplace where people license proprietary AI (agents, pipelines, prompts+tools, later models)
for private evaluation and use, without the platform or the host being able to read anyone's asset.

**First product (hackathon):** *confidential AI test drives.* A seller lists a sealed AI agent. A buyer pays per
call to run it on their own private benchmark, gets a report where every answer is TEE-signed by that exact agent,
and can rate it on-chain with proof that the call really happened.

**The one transaction that must work end to end:** seller lists → buyer funds a test-drive job → buyer calls the
sealed agent N times, paying per call → buyer gets a graded, signed report → buyer leaves proof-backed feedback →
unused budget is refundable.

**Non-goals for the hackathon:** training/fine-tuning, model-weight assets, outcome-based pricing, our own TEE
worker, our own token, our own backend server, x402/other payment chains.

**Anti-goals (would be a failure even if it "works"):**
- Anything labelled "attested"/"confidential" that isn't backed by real attestation.
- A platform server that can see keys, benchmarks or seller IP.
- Custom code where a published, maintained component already does the job.

---

## 2. Reuse-first: what we take, what we write

The rule: if a maintained, documented component exists, we use it unchanged. We only write glue.

| Need | Prebuilt component we use (unchanged) | What we write |
|---|---|---|
| Seller's asset sealed in a TEE, keys never exposed | **0G AgentDNA / Agentic ID** (`@0gfoundation/0g-agentdna` 0.4.0, already installed). Agents run in attested TDX "sealed sandbox" containers; iData is ERC-7857 encrypted data; the KMS→attestor→container chain provisions keys; owner never holds the agent key. Live on Galileo via `https://agentdna-testnet.0g.ai`. | A reference seller agent (persona + one `/api/*` service). |
| Proof that a specific agent produced a specific answer | AgentDNA **serve-proofs** (`X-Agent-Proof` on `/api/*` responses, signed by the agent's TEE-held key, bound to request/response bytes and the agent's iData version). `fetchWithProof` + `verifyProof`. | Nothing. |
| Reputation | AgentDNA **VerifiedFeedbackRegistry** + canonical **ERC-8004** Reputation (`ag.reputation.giveFeedback({ agentId, value, serveProof })`). | Nothing. |
| Escrow + pay-per-call | **ERC-8183 reference implementation** `erc-8183/base-contracts` (MIT, Foundry, `evm_version = "cancun"`, includes `settleClaim` streaming payments, `claimRefund`, hooks, `MockUSDC`). | Deploy script only. |
| "Buy a private copy" (Phase 5) | AgentDNA **clone** + **CloneGate** + `ICloneAuthorizer` (marketplace fork, issue #133). Attestor re-keys sealed data to the buyer's copy. | One ~40-line `ICloneAuthorizer` that says yes when an ERC-8183 purchase job is Completed. |
| Encrypted private data (buyer benchmark, reports) | **0G Storage SDK** built-in `aes256` encryption (proven in `examples/02`). | Key derivation from a wallet signature. |
| AI in the main flow | **0G Private Computer** Router, `X-0G-Provider-Trust-Mode: private`, model `0gm-1.0-35b-a3b` (proven in `examples/03`). | Grader + plain-English summary prompts. |
| Public, queryable marketplace catalog | **Arkiv** (`@arkiv-network/sdk` 1.0.1, Rabdi testnet, chain 7794095). | Two schemas: listing, score. |
| Verifiable client (CROPS) | Static Vite app + the official **`0g-agentdna` CLI** as an independent client. | The app. No backend. |

What we are deliberately **not** building any more (vs. the old plan): our own TDX worker, our own ERC-7857 contract,
our own escrow, ECIES key-release protocol, enclave registration, attestation verification code. AgentDNA already does
all of it on real TDX hardware, which also removes our biggest blocker (this server has no TDX).

---

## 3. Architecture

```
            ┌──────────────────────────── user's machine ────────────────────────────┐
 Seller ──▶ │ Static web app / CLI (open source, built from this repo, no backend)   │ ◀── Buyer
            │  • wallet signs everything   • benchmark encrypted locally             │
            └───┬───────────────┬────────────────┬────────────────┬──────────────────┘
                │               │                │                │
        Arkiv (Rabdi)    0G Chain (Galileo)   0G Storage     0G Private Computer
        listings,        ERC-8183 escrow,     encrypted      grader + summary
        public scores    AgentDNA contracts,  benchmark,     (request IDs shown)
                         ERC-8004 feedback    reports
                │
                └──────────▶ AgentDNA sealed agent (TDX container, 0G-hosted)
                              seller's persona/skills/service code = ERC-7857 iData
                              /api/* answers carry TEE serve-proofs
```

### Where each piece of data lives

| Data | Where | Visible to |
|---|---|---|
| Seller's agent internals (prompt, skills, service code) | AgentDNA iData: encrypted on 0G Storage, key sealed to the agent's TEE | Only the agent's TEE. Not the platform, not 0G's host, not the buyer. |
| Listing (title, category, price, agentId) | Arkiv entity owned by the seller's wallet | Public |
| Test-drive job + payments | ERC-8183 contract on 0G Galileo | Public |
| Buyer's benchmark cases | 0G Storage, `aes256`, key derived from buyer's wallet signature | Buyer only (plus the agent sees each case it answers, see §5) |
| Signed answers + report | 0G Storage, encrypted to the buyer | Buyer; buyer may publish a score |
| Public score (opt-in) | Arkiv entity owned by the buyer + ERC-8004 feedback | Public |
| Grader prompts | 0G Router private mode | 0G gateway sees plaintext (0G calls it "tier 2.5"); disclosed in UI |

---

## 4. Flows

### A. Seller lists an agent
1. Seller deploys an AgentDNA agent from our template (framework `openclaw`; persona + seller's service). SDK:
   `AgentDNA.fromAttestor(TESTNET_ATTESTOR, { account })` → `ag.ack()` → `ag.deposit({ amountWei })` →
   `ag.agent.deploy({...params, sandbox: undefined}, { wait: 'minted' })` → `ag.agent.start(sealId, { apiKey })`
   (deploying without `sandbox` keeps the model key sealed, per the SDK guide).
2. The agent registers its `/api/*` service (sealed proxy signs every buffered response).
3. Seller writes an Arkiv `listing` entity: `agentId`, `category`, `title`, `pricePerCall`, `token`, `escrow`, expiry.
   Readers only trust a listing whose Arkiv `$creator` equals `ownerOf(agentId)` on 0G Chain.

### B. Buyer test-drives (pay per call)
1. Buyer browses listings from Arkiv (the user-visible Arkiv read).
2. Buyer `createJob(provider=seller, evaluator=buyer, expiredAt, description, hook=0, providerAgentId=agentId)`,
   `setBudget`/`fund` with `N × pricePerCall` of the payment token.
3. For call k: buyer `settleClaim(jobId, k × price, deliverable=keccak(request), 0x)` then calls the agent's
   `/api/*` with an EIP-191 signature over `(APP_ID, jobId, k, sha256(body))`.
4. The seller's service checks on chain: job is Funded, signer = `job.client`, `settledAmount ≥ k × price`. Then it
   answers. The response carries a serve-proof.
   Risk is bounded to one call on either side. No evaluator trust is needed.
5. After expiry, `claimRefund` returns any unsettled budget (anyone can call; not hookable, so nobody can block it).

### C. Buyer gets a report and rates
1. The client verifies each serve-proof (`verifyProof(proof, { task })` → `ok`).
2. The grader (0G Private Computer, private mode) scores each answer against the buyer's rubric and writes a
   plain-English summary. Request IDs are stored per case and shown.
3. The report (cases hashes, answers, proofs, scores, request IDs) is encrypted and uploaded to 0G Storage.
4. Optional, buyer's choice: publish a `score` entity on Arkiv and `giveFeedback({ agentId, value, serveProof })`.

### D. Buy (Phase 5, decided by spike result G2)
- If the clone-extraction probe (T1.5) shows a buyer-owned copy cannot trivially leak seller internals: **buy a
  private copy** via `CloneGate` + our `PurchaseCloneAuthorizer` (yes iff an ERC-8183 purchase job for that buyer and
  agent is Completed).
- Otherwise: **buy hosted access** = flow B with a long-lived job and no expiry pressure. No new contract.

### Why buyers come back tomorrow
Their encrypted benchmark vault stays. When a new agent is listed in their category (Arkiv query), the app shows
"N new agents you can test on your benchmark" with one click to start a test drive, and a private leaderboard of every
agent they've tried.

---

## 5. Trust model (honest version)

| Protected | Against | By |
|---|---|---|
| Seller's agent internals | Platform, 0G host, buyer | AgentDNA TEE + sealed iData. The buyer only gets `/api` outputs. |
| Buyer's benchmark at rest | Platform, storage nodes | Client-side `aes256`, key from the buyer's wallet. |
| Which agent produced an answer | Seller lying, platform lying | Serve-proof signed by the agent's TEE-held key, checked against chain state. |
| Payments | Either party | ERC-8183 escrow; ≤1 call of exposure; refunds can't be blocked. |
| The app itself | A malicious operator | No backend; open source; runs from the repo with any RPC (CROPS, §6). |

**Known limits (we say these out loud in the README and demo):**
1. **The seller can talk to their own agent.** Each test case the buyer sends is seen by the seller's agent, and the
   owner has a private chat channel to it (AgentDNA TRUST_MODEL "owner attack surface"). So buyer cases are hidden
   from the platform and the host, **not from a determined seller.** Advice: use test cases you're OK sharing with the
   vendor. Roadmap: run test drives on a clone that neither party owns.
2. **A serve-proof proves who answered, not that the answer is right.** Quality is the grader's and the buyer's
   judgement.
3. **The grader's gateway sees plaintext** (0G "tier 2.5"). Buyers can switch to local exact-match grading.
4. **We trust AgentDNA's attestor, KMS and sandbox provider** (its acknowledged "trust root", `ag.ack()`), Intel TDX,
   and 0G's TappRegistry.
5. **VERIFY:** does the agent's public URL terminate TLS inside the TEE, or at 0G's sandbox proxy
   (`art-testnet.0g.ai`)? Until verified, we don't claim buyer inputs are hidden from 0G infrastructure in transit.

Words we never use: "trustless", "nobody can learn anything", "attested" for anything that isn't.

---

## 6. CROPS (Ethereum Foundation track): lead property = Censorship resistance

Not a bolt-on: the reuse architecture has **no backend**, so "works when we disappear" comes for free. We make it
structural and demo it.

- **C:** We control nothing the user depends on at runtime. The app is static files built from this repo; it talks
  directly to public 0G RPC, the 0G Storage indexer, Arkiv RPC, the 0G Router and the agent's URL, all of which the
  user can swap in Settings. Demo: build from the repo, run it locally, change RPCs, do a full test drive. A CLI
  (`npx tsx cli/...`) and the official `0g-agentdna` CLI do the same without the web UI.
- **O:** MIT. `npm ci && npm run build` from the repo alone. Stretch: publish the `dist/` hash so users can check the
  hosted copy matches the repo.
- **P:** What each third party learns (table goes in the README): 0G RPC and Arkiv RPC see the wallet address and
  reads; the Arkiv RPC key identifies the app (user can bring their own); 0G Router sees grader prompts; the agent
  (and its owner, see §5) sees test cases; no analytics, no trackers.
- **S:** Keys stay in the user's wallet. The benchmark key is derived from a wallet signature (deterministic, so it's
  recoverable with nothing from us). Trust assumptions are in §5.

Requirements to meet: README section titled `CROPS`, demo video ≤ 3 min showing it running without us, no trackers.
**Admin keys:** the ERC-8183 reference contract has admin roles (pause, `emergencyWithdraw` while paused, UUPS upgrade).
After setup we renounce them, and a test proves no admin remains (otherwise "S" fails).

---

## 7. Sponsors (from the ETHGlobal Mumbai prize pages)

| Track | Fit | Must show |
|---|---|---|
| 0G: Build with 0G Private Computer ($5k), primary | Grader + summary in the main buyer flow | Inference in main flow with request IDs; a working app a judge can try; a reason to return tomorrow; "what breaks without 0G" sentence. Bonus: 0G account sign-in with credits going down (stretch, VERIFY). Risk: track asks for a *consumer* app, so we pitch to individuals and small teams choosing an AI agent, not enterprise procurement. |
| Arkiv: Build on Arkiv from scratch ($4k) | Listings + public scores, browse page reads from Arkiv | Writes to testnet; a user-visible feature reads from Arkiv; README lists writer wallets + one query; `/arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`; open-source license; AI-use disclosure. |
| EF: Best CROPS App ($3.5k) | §6 | README `CROPS` section; ≤3-min video of the lead property; no trackers. |
| 0G: Agents That Pay for Themselves ($2k), stretch | The sealed agent is the ERC-8183 provider's payout receiver and pays for its own inference | Full loop with tx hashes + request IDs; spend cap; graceful degradation. Blocked on VERIFY: how an agent tops up its own Router credit. |

"What breaks without 0G": without 0G there is no attested place to run the seller's agent, no proof that a given
answer came from it, no private grader, and no escrow; buyers and sellers would have to trust our server with both
the agent and the benchmark.

**VERIFY:** ETHGlobal's limit on partner prizes per project, and whether the Arkiv "built from scratch at Mumbai"
rule is affected by the four pre-event examples in `examples/` (we can move them out of the submission repo).

---

## 8. Decisions (each one is final unless a gate result reopens it)

| # | Decision | Why | Rejected |
|---|---|---|---|
| D1 | The first asset type is a **sealed AI agent** on AgentDNA. | The only live, real-TEE runtime available to us; zero custom TEE code. | Small trained model in our own worker (no TDX here, so it would be mock-only). |
| D2 | The first transaction is a **pay-per-call test drive** using ERC-8183 `settleClaim`. | Fixed price, ≤1-call risk, no evaluator trust, reference code unchanged. | Metric-uplift pricing (ChatGPT agrees: benchmark integrity is unproven); buyer-as-evaluator lump sum (buyer could refuse to pay after use). |
| D3 | Use the ERC-8183 reference `erc-8183/base-contracts` **unchanged**, then renounce admin. | Reuse plus CROPS "S". | Writing our own escrow (old plan). |
| D4 | **No backend.** Static app + CLI. | CROPS lead property; nothing to hack or subpoena. | Next.js API routes, a DB. |
| D5 | Arkiv holds only **public** data (listings, opt-in scores). | Arkiv is public; private state stays local or encrypted on 0G. | Arkiv as the job database. |
| D6 | ERC-8004 reputation via AgentDNA's VerifiedFeedbackRegistry. | Already deployed, proof-backed, sybil-resistant by construction. | Our own reputation contract. |
| D7 | Grading runs on 0G Private Computer with the gateway's plaintext visibility disclosed; exact-match grading is a local option. | Track requirement + honesty. | Claiming "fully private" grading. |
| D8 | "Buy" product chosen by gate G2 (clone vs hosted access). | Don't build a sale flow that leaks seller IP. | Deciding now. |
| D9 | No customization or training in the hackathon. | No TEE training path is available to us; 0G fine-tuning is provider-run. Roadmap. | Agent-driven fine-tuning loop (old plan). |
| D10 | Stacks: `viem` for AgentDNA, Arkiv and contracts; `ethers@6.13.1` only inside the 0G Storage module. | The SDKs require it (0G skills rule). | Mixing them in one module. |
| D11 | Docs: one plan (this file), one tracker (`docs/TASKS.md`), per-phase step plans. | Agents need one place to look; fewer files to drift. | Nine separate docs. |

How ChatGPT's corrections are covered: small purpose-built contracts → D3 (even smaller: reuse); enclave signature ≠
success → §5 limit 2; key release via a local client → there is no key release to the platform at all (D4);
usable deliverable → hosted access or a clone (D8), no adapters; fixed fees → D2; gated phases → §9; mock never
says attested → AgentDNA is real TDX, and the only mock is local dev, labelled.

---

## 9. Phases and gates

Each phase ends with an explicit exit check. **Cut line: Phases 1–4 = a complete hackathon submission.**

| Phase | Goal | Exit check (evidence goes in `docs/TASKS.md`) |
|---|---|---|
| 0 Freeze | This plan approved | User says yes |
| 1 Prove the reused pieces | Every borrowed component works for us on testnet | Gate **G1**: a non-owner calls a seller-defined `/api/*` service on a sealed agent and `verifyProof` returns `ok: true`. Gate **G2**: clone-extraction result recorded. Plus: Arkiv entity key + query, grader request ID, feedback tx, ERC-8183 tests passing locally. |
| 2 Contracts on Galileo | ERC-8183 + MockUSDC deployed, admin renounced | Addresses + tx hashes; a scripted create→fund→settleClaim→claimRefund run on testnet; a test shows no admin role holder. |
| 3 One full transaction (CLI) | Flows A–C end to end | One testnet run with: listing entity key, job id, ≥3 paid calls with proofs, report root, request IDs, feedback tx, refund tx. |
| 4 Web app + CROPS + Arkiv files | Judge-usable app | Browse (reads Arkiv), test drive, report with request IDs; CROPS README; `/arkiv/*.md`; app run from a fresh clone with swapped RPCs. |
| 5 Buy | Flow D per G2 | A buyer-owned copy or a long-lived access job works on testnet. |
| 6 Stretch | Agent pays itself; 0G sign-in; build-hash proof | Each needs its VERIFY item answered first. |
| 7 Submit | README, video, prize forms | Checklist in `docs/TASKS.md`. |

---

## 10. Open questions (ask at the 0G and Arkiv booths)

1. AgentDNA: can a seller ship deterministic service code in iData at mint (openclaw `workspace/` role), or must the
   agent create its service itself? (T1.3 tests this.)
2. AgentDNA: is TLS to an agent's public URL terminated inside the TEE?
3. AgentDNA testnet: sandbox costs 0.004 0G/min for 2 CPU/4 GB (live `estimateCosts`), and we hold about 0.5 0G.
   Can we get more testnet 0G, and can the container spec be smaller?
4. Which Router network do testnet AgentDNA agents use for `0g-compute` inference, and does our `ZG_API_KEY` work there?
5. How can an agent wallet top up its own Router credit (Payment Layer function)? Needed for the self-paying track.
6. Is there an ERC-20 test stablecoin on Galileo we should use instead of deploying `MockUSDC`?
7. Arkiv: does the "built from scratch" rule allow a repo containing pre-event 0G examples?

---

## Sources (read 2026-11-06)

- AgentDNA SDK README + GUIDE (`node_modules/@0gfoundation/0g-agentdna/`), live `https://agentdna-testnet.0g.ai/config`,
  repo `https://github.com/0gfoundation/0g-agentic-id` (`sealed/TRUST_MODEL.md`, `contracts/src/StandardCloneAuthorizer.sol`,
  `contracts/src/interfaces/ICloneAuthorizer.sol`, `sealed/AGENT_DOCTRINE.md`)
- ERC-8183 spec `https://eips.ethereum.org/EIPS/eip-8183`; reference `https://github.com/erc-8183/base-contracts`
- Arkiv docs `https://docs.arkiv.network/llms.txt`; npm `@arkiv-network/sdk` 1.0.1
- ETHGlobal Mumbai prizes: `/events/mumbai/prizes/0g`, `/prizes/arkiv`; EF CROPS track text as published on the
  prize page (provided by the team)
- 0G docs + official skills in `.0g-skills/`; facts in `.claude/skills/sealedai-stack/SKILL.md`; our passing
  `examples/01-04`
