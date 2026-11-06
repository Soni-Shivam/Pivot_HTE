# Task tracker

The live status of the build. Spec: `docs/PLAN.md`. Step-by-step plans: `docs/superpowers/plans/`.

## Rules for agents (also in CLAUDE.md)
1. Pick the first `todo` task whose `Needs` are all `done`. Set it to `doing` and add your session name.
2. A task is `done` only when its **Evidence** cell holds something a stranger can check: a tx hash, contract
   address, 0G Storage root, Router request ID, Arkiv entity key, agentId, or a test command plus its passing output
   line. "Works on my machine" isn't evidence.
3. If a task is blocked, set `blocked` and say on what. If it changes a decision in PLAN.md, add a line to the
   change log at the bottom and tell the user.
4. Never paste `.env` values. Addresses and tx hashes are public; keys are not.

Status values: `todo` · `doing` · `blocked` · `done` · `cut`

## Phase 0: Freeze
| ID | Task | Needs | Status | Evidence |
|---|---|---|---|---|
| T0.1 | User approves `docs/PLAN.md` | — | todo | |
| T0.2 | Install ponytail plugin (`claude plugin install ponytail@ponytail`; the marketplace is already added) | — | blocked: needs the user to run it | |

## Phase 1: Prove the reused pieces (plan: `docs/superpowers/plans/2026-11-06-phase1-prove-reuse.md`)
| ID | Task | Needs | Status | Evidence |
|---|---|---|---|---|
| T1.1 | Fund wallets: 0G faucet, Arkiv faucet; AgentDNA `doctor` all green, `ack`, `deposit` | T0.1 | todo | |
| T1.2 | Deploy the reference seller agent on testnet (mint-only, then `start`); `sayHi` verification ok | T1.1 | todo | |
| T1.3 | **Gate G1**: the seller's `/api/*` service is called by a second wallet, `verifyProof` ok, and the service can read 0G chain | T1.2 | todo | |
| T1.4 | Proof-backed feedback from the second wallet (`giveFeedback` with `serveProof`) | T1.3 | todo | |
| T1.5 | **Gate G2**: clone probe: StandardCloneAuthorizer grant → buyer clone → try to extract the seller persona via owner chat; record the result | T1.2 | todo | |
| T1.6 | Arkiv: create a `listing` entity, query it back by category | T1.1 | todo | |
| T1.7 | Private Computer grader: score one answer as JSON, log request ID | — | todo | |
| T1.8 | Install Foundry (ask the user before running any downloaded script); vendor `erc-8183/base-contracts` at a pinned commit; `forge test` passes | T0.1 | todo | |
| T1.9 | Ask the 0G/Arkiv teams PLAN §10 questions; record answers in PLAN.md | — | todo | |

## Phase 2: Contracts on Galileo (step plan written when Phase 1 is done)
| ID | Task | Needs | Status | Evidence |
|---|---|---|---|---|
| T2.1 | Deploy MockUSDC + ERC8183 proxy on Galileo; allow the token; fees 0 | T1.8 | todo | |
| T2.2 | Renounce all admin roles; a test proves no holder remains | T2.1 | todo | |
| T2.3 | Scripted testnet run: createJob → fund → settleClaim ×2 → expiry → claimRefund | T2.2 | todo | |

## Phase 3: One full transaction via CLI
| ID | Task | Needs | Status | Evidence |
|---|---|---|---|---|
| T3.1 | `packages/core`: escrow client, Arkiv schemas, vault (0G Storage), grader, proof check | T1.3–T1.7, T2.3 | todo | |
| T3.2 | Seller service: payment check (job Funded, signer = client, `settledAmount ≥ k×price`) | T1.3, T2.3 | todo | |
| T3.3 | CLI: `seller list`, `buyer drive`, `buyer report`, `buyer rate` | T3.1, T3.2 | todo | |
| T3.4 | One complete testnet run with every evidence ID | T3.3 | todo | |

## Phase 4: Web app + CROPS + Arkiv files (cut line ends here)
| ID | Task | Needs | Status | Evidence |
|---|---|---|---|---|
| T4.1 | Static Vite app: browse (Arkiv), test drive, report with request IDs, settings with swappable RPCs | T3.4 | todo | |
| T4.2 | README with `CROPS` section, third-party table, run-from-repo steps | T4.1 | todo | |
| T4.3 | `/arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md` | T3.4 | todo | |
| T4.4 | Fresh-clone test: build, run locally, swap RPCs, full test drive | T4.1 | todo | |

## Phase 5: Buy (shape decided by G2)
| ID | Task | Needs | Status | Evidence |
|---|---|---|---|---|
| T5.1 | Clone path: `PurchaseCloneAuthorizer` + buyer clone, OR hosted-access path: long-lived job | T1.5, T3.4 | todo | |

## Phase 6: Stretch
| ID | Task | Needs | Status | Evidence |
|---|---|---|---|---|
| T6.1 | Agent pays itself (payout receiver = agentSeal, Router top-up) | PLAN §10 Q5 | todo | |
| T6.2 | 0G account sign-in (iAI) with visible credit use | VERIFY flow | todo | |
| T6.3 | Publish build hash; verify the hosted app matches the repo | T4.4 | todo | |

## Phase 7: Submit
| ID | Task | Needs | Status | Evidence |
|---|---|---|---|---|
| T7.1 | README: run steps, writer wallets, one Arkiv query, request IDs, contract addresses, AI-use disclosure, license | T4.* | todo | |
| T7.2 | Demo video ≤ 3 min: full transaction + running without us | T4.4 | todo | |
| T7.3 | Prize forms: 0G PC, Arkiv, EF CROPS (+ stretch tracks if done) | T7.1 | todo | |

## Change log
- 2026-11-06: tracker created from PLAN.md draft.
