# Faultline: every Web3 piece, why it is there, and how we show it

Faultline tests autonomous vehicles with an AI adversary. The pitch in one line: **nobody trusts a safety benchmark
whose referee has a stake, so the referee has to be infrastructure.** Each Web3 piece below does one referee job.
If a piece could be deleted without losing a guarantee, it is marked as such.

## 1. The stack at a glance

| # | Piece | Network | Job it does (what breaks without it) | Live proof |
|---|---|---|---|---|
| 1 | **0G Private Computer** (Router, `0gm-1.0-35b-a3b`, private tier / TeeML) | 0G mainnet | The adversary's decisions are made inside a TEE that neither we (the test vendor) nor the car maker can steer mid-run. Without it, "the AI chose this" is our word. The private tier refuses to downgrade: a standard-only model returns 503 | 300+ decisions with request IDs; downgrade refusal `f9b332f9…` (503 `no_provider_for_trust_mode`) |
| 2 | **0G provider signatures, archived** (Compute SDK `processResponse`, TDX quote) | 0G mainnet (service registry) | Proves *which* TEE provider answered each decision. Providers drop signatures after ~20 min, so we archive them at publish and re-check offline | demo-003 8/8, cutin-002 6/6, paid job 002 7/7, swarm 008/010 10/10 each |
| 3 | **0G Storage** (public JSON + sealed AES-256-GCM tar, per-episode key via HKDF) | Galileo testnet | The episode record lives where neither party hosts it, and the download is checked against its Merkle root. Public half: decisions, metrics, trajectory. Sealed half: observations, scenario, salt — only the key holder opens it | demo-003 public `0x69a532d1…6a89`; paid job 002 public `0xc1219e48…6748` |
| 4 | **EpisodeRegistry v2** (commit-before / finalize-after) | Galileo | Fixes the scenario and config **before** the first AI call and the roots + result **after** the last. Stops picking the scenario after seeing the result, or reporting a rerun as the first run. Each prompt carries the commit block's hash and a nonce the model must echo | `0xeE2260cE4835059F0e0f1FB9C9948Ca5a7d4b5A4`; demo-003 commit at 22:03:08Z, first 0G call 22:03:27Z |
| 5 | **ERC-8004 agent identity** | Galileo | Gives the adversary a declared, owner-controlled identity so reputation and memory attach to one agent + prompt hash | agentId **579**, tx `0x84974f06…67fa` |
| 6 | **AgentMemoryRegistry** (versioned safety memory) | Galileo | Anchors each campaign's sealed memory snapshot (Merkle root over every experiment record) per agent and per model version, so "v1.1 fixed v1.0's cut-in failure" is checkable later | `0x7a8676D267f1aa17d6B55cF5BfcD2A9509b963e3` (deployed; anchoring in progress) |
| 7 | **Hedera x402** (pay-per-test, spending cap, one-run permit) | Hedera testnet | A company's agent buys one stress test with no human approving: quote → pay 0.001 HBAR → permit bound to one suite (kinematic or CARLA) → run → report. Payment is proven by Hedera; the run is proven by 0G | job 002 (CARLA) tx `0.0.9185802@1794006563.434123686`; job 001 (kinematic) `0.0.9185802@1794004328.340591562` |
| 8 | **Arkiv** (shareable safety claims) | Arkiv Rabdi testnet | Publishes aggregate claims ("model v1.1: N tests, X % collisions") as entities owned by the car maker's wallet, queryable by model / version / category, each linking to sealed evidence an auditor can recompute | in progress (`arkiv/*.md` written) |

**Not Web3, said plainly:** CARLA and the driving stack run on our machine. 0G proves the decisions and the record,
not the physics; replay and config hashes support simulation integrity, which is a separate claim.

## 2. Why each one is required (the judge's "why not a database?")

- **TEE inference (1, 2):** a database would hold whatever we wrote. A signed TEE answer means the decision came from
  a specific enclave running a specific model, and the private tier means no fallback model was swapped in.
- **Storage with a root (3):** "the file was lost" or "the log was edited" stops being possible: the root fixes
  the bytes, and the sealed half keeps the car maker's scenario private.
- **Commit/finalize on chain (4):** timestamps nobody controls. This is the piece that defeats cherry-picking,
  the main way benchmarks get gamed.
- **Identity + memory anchors (5, 6):** safety history becomes an asset the car maker owns and can carry to
  another testing vendor, with versions that cannot be quietly rewritten.
- **x402 (7):** agents can buy tests per job without accounts or invoices; the permit means one payment buys
  exactly one run of exactly the suite paid for.
- **Arkiv (8):** insurers and fleet buyers can query claims across car makers without asking anyone for access,
  and every claim points to evidence.

## 3. What we will not claim
"Verified safe", "certified", "trustless", "tamper-proof". The model reads observations inside the enclave (not
private from 0G's enclave). Content binding of the signed answer to our logged text is **not** checkable today
(the Router encrypts each private turn end to end; the provider signs the ciphertext — audit A2).

## 4. Presentation: what sells, and how we show it

Judges remember what they *see* happen. Every Web3 guarantee above needs a visible moment:

| Guarantee | The visible moment |
|---|---|
| AI decided it, in a TEE | The swarm video: four cars move on one 0G plan, the card shows the model's exact JSON and request ID |
| Nobody can fake the record | "Verify it yourself": paste a root, watch each check turn green in sequence (download + root, files, metrics recomputed, signatures, commit-before, nonce, replay) |
| No cherry-picking | A timeline: commit block → first 0G call → last call → finalize, with chain links |
| The AI does real research | Safety-boundary replay: experiments appear one by one, the boundary emerges, then minimize → explain → fix |
| Memory across versions | v1.0 vs v1.1 board: each old failure marked fixed / persists / new |
| Agents pay for tests | Paid-job timeline: quote → Hedera tx (HashScan) → permit → CARLA run → Galileo → 0G roots → 409 on reuse |

### Proposed build for the remaining 3 hours
1. **One "Faultline Mission Control" site** (static, `apps/faultline-web`), five tabs reusing what exists:
   *Live attack* (director/stitched video + synced decision feed), *Verify* (animated sequential checks on a real
   root — the existing verifier, restyled), *Research* (the boundary-hunt replay + mission), *Memory* (v1.0 vs
   v1.1 from Arkiv), *Paid jobs* (Hedera → 0G timeline). One trust diagram on the landing view.
2. **Public live link** (GitHub Pages; required by 0G's submission rules) — needs the team's OK.
3. **3-minute demo video** from the real clips, following this table's order.
4. **README** rewritten around the table in §1, with every address, root and tx.

Order: (1) and (4) in parallel now → (2) → (3) last, recorded from the finished site.
