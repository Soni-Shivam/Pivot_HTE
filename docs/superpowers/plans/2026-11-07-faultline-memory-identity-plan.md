# Faultline: persistent, version-aware safety memory (audit + plan)

2026-11-07. Audit of the four ideas from the teammate's review (A–D) against what Faultline already has, the
ETHGlobal Mumbai prizes, and build cost. "System 2" = the slow research agent (`faultline/research.py`: designs
experiments, minimizes, explains, proposes fixes); "System 1" = the per-checkpoint 0G adversary.

## Verdict per idea

| Idea | Relevant? | Why | Builds on (already in repo) | Prize it strengthens | Cost |
|---|---|---|---|---|---|
| **B. Model-specific, version-aware memory** | **Yes, do first** | Turns one-off tests into a regression history: "v1.0 failed aggressive cut-ins; does v1.1?" It is measurable today: we have a real v1.0 → v1.1 pair (IDM default vs the grid-found fix that cut suite failures 19 → 0) | failure library (57 fingerprints), research loop, config hash, policy commitment in the Hedera flow | 0G Physical AI (core), 0G Keep Building | ~0.5 day |
| **A. Persistent identity + memory** | **Yes** | The model owner keeps the accumulated safety intelligence across platforms; memory becomes an owned, verifiable asset | ERC-8004 agent 579 on Galileo, AES-GCM envelope, 0G Storage publish, registry pattern | 0G Physical AI ("memory on 0G Storage"), 0G Keep Building | ~0.5 day |
| **C. Confidential + shareable memory** | **Yes** | Same split we already use for episodes (public JSON vs sealed tar), lifted to campaign aggregates: share "v1.1: 500 low-friction tests, 2.4 % collisions" without trajectories; an auditor with the key checks it | public/sealed bundles, tenant key + HKDF per episode, Merkle-root check, Arkiv SDK + keys | **Arkiv** (claims are entities people query and the dashboard reads), 0G | ~0.5–1 day |
| **D. Authenticated agent-to-agent** | **Yes, but last** | Only worth it with a real second agent: the perception/occlusion tester (`faultline/occlusion.py`) as its own service. System 2 hires it when failures cluster on perception, pays over x402, both sides sign | Hedera x402 paid-job service (Vedant), ERC-8004, occlusion sweep | **Hedera** x402 (extra points: agents hiring agents, ERC-8004 identity, HCS audit log, spending caps) | ~1 day |

Not adopted: a custom ".8004" name (no such naming system; ERC-8004 gives a numeric agentId — we pair it with
an optional ENS name only if we enter ENS). 0G AgentDNA / Agentic ID (ERC-7857) is real but needs the agent to
run in a TDX sealed container with 0G's provider — out of scope; our identity is ERC-8004 + an owner wallet,
said plainly. "0run's two-layer memory / A2A" is used as inspiration only; we did not read its code and do not
claim compatibility.

## Prize strategy (ETHGlobal lets a team pick up to 3 partner prizes; Arkiv's count as one)
1. **0G** — Physical AI (primary: 0G in the decision loop, episode logs with request ids, replay, safe stop are
   all done and evidenced) + Keep Building if we qualify as continuity (we would need the dated prior-state
   commit). Memory on 0G Storage and anchors on Galileo make the 0G story deeper.
2. **Hedera** — "AI Agents That Pay": Vedant's x402 paid job already settles on testnet; D adds the strongest
   extra-point items (agents paying agents, ERC-8004 identity, HCS audit log, spend caps).
3. **Arkiv** — "Build on Arkiv": the shareable claims layer (C) is real Arkiv use: owner wallet = the OEM,
   expiring claims per test campaign, SQL-like filters (model, version, category, rate), and the dashboard
   reads them. Needs `/arkiv/{schema,friction,reach,why-arkiv,how-you-use-arkiv}.md`.
Considered and dropped for focus: World ID Agent Pass (a human approval gate before publishing a "release
certificate" fits, but it is a fourth integration), ENSv2 naming, Chainlink, Uniswap, 1inch, Whitechain, Arc.

## Architecture

```
            model owner (OEM) wallet ──owns──► memory, claims, agent identity (ERC-8004 #579)
                      │
System 2 (0G, private tier) ── reads ──► MEMORY (keyed by model_id@version)
   │  plans campaign / regression          ├─ private layer: full experiment history, trajectories,
   │                                       │   configs, hypotheses → sealed (AES-256-GCM, HKDF(tenant key,
   ▼                                       │   memory_version)) → 0G Storage → sealedRoot
deterministic runner (kinematic / CARLA) ──┤─ shareable layer: aggregates per (model, version, category)
   │  episodes, fingerprints, metrics      │   with evidence refs → public JSON → 0G Storage → publicRoot
   ▼                                       │   + Arkiv entities (one per claim) for query
AgentMemoryRegistry (Galileo)  ◄── anchor (agentId, modelId, version, seq, publicRoot, sealedRoot, prevRoot,
                                    claimsRoot) after each campaign
```

### Data model
- **ModelRef** `{model_id: "idm-follower" | "pdm-lite-lidar", version: "1.0", artifact_digest: sha256 of the
  controller source/params, params}` — the digest goes into every experiment's config hash.
- **MemoryRecord** (private, append-only JSONL): experiment params, config hash, outcome metrics, fingerprint,
  episode/run refs (0G roots, request ids), hypothesis tested, verdict.
- **Memory snapshot** v_n: `{agent_id, model_ref, records_root (Merkle over record hashes), fingerprints
  summary, open_hypotheses, explored_regions, prev_snapshot_root}` sealed + public summary.
- **Claim** (shareable): `{model_id, version, category (lead_brake|cut_in|low_friction|occlusion|swarm), n_tests,
  n_collisions, rate, ci95, metric summaries, records_merkle_root, inclusion proof format, publicRoot,
  anchor tx}`. An auditor with the tenant key opens the sealed snapshot, recomputes the Merkle root over the
  records for that category, and checks n/rate exactly.

### Version-aware regression (B), the demo
1. Memory for `idm-follower@1.0` exists (the 57 failures + research mission).
2. Owner releases `idm-follower@1.1` (the measured fix: bounded IDM params from the research run).
3. System 2 loads v1.0 memory, schedules a regression campaign: re-run every v1.0 failure fingerprint's
   minimized case + boundary probes against v1.1, then explores categories where v1.1 changed behaviour.
4. Deterministic code classifies each fingerprint: **fixed / persists / new weakness / regressed category**
   (with the per-category rate and efficiency cost). 0G writes the report; the audit step checks its claims.
5. Snapshot sealed + anchored; claims published to Arkiv; dashboard shows v1.0 vs v1.1 side by side.
Same flow for `pdm-lite-lidar@1.0 → 1.1` (e.g. the throttle-scale change) if time allows (CARLA, slower).

### Agent-to-agent (D)
- Second agent: `faultline-perception-tester` (own ERC-8004 id) exposing the occlusion sweep as an x402
  endpoint on Vedant's Hedera service (`POST /v1/perception-sweeps`).
- System 2 requests it when ≥ k failures carry a perception fingerprint (LiDAR gap error, late tracking):
  EIP-712-signed request (agentId, model_ref, case, budget, nonce), spending policy checks cap + allowlisted
  merchant, pays 0.001 HBAR, receives an EIP-712-signed result; both messages + the Hedera tx id go into the
  memory record; every spend is appended to an HCS topic (tamper-evident audit log).

## Stack
- Python 3.12 (`faultline/memory.py`, `faultline/regression.py`): records, snapshots, Merkle roots,
  regression classifier; reuses `research.py`/`experiment.py` executors and fingerprints.
- TypeScript (`packages/memory/`): seal + publish snapshot (reuse `protocol/envelope.ts`, `integrations/storage.ts`),
  anchor (viem, like `episode/src/anchor.ts`), Arkiv claims (`@arkiv-network/sdk` 1.0.1, already a dependency;
  Rabdi testnet, chain 7794095), auditor verify CLI.
- Solidity (`contracts/src/AgentMemoryRegistry.sol`, Foundry, Galileo): `anchor(agentId, modelId, version,
  publicRoot, sealedRoot, prevRoot, claimsRoot)` callable only by the agent's owner (checked against the
  ERC-8004 registry's `ownerOf`, or a recorded owner if that ABI can't be read from an authoritative source);
  per-(agent, model) sequence; events.
- Web: a "Safety memory" page (in `apps/faultline-web`) reading Arkiv claims + the registry, v1.0 vs v1.1.
- Hedera (D): x402 (`@x402/*` 2.30.0, already pinned), HCS via the Hedera SDK only if already resolvable from the
  lockfile; otherwise Mirror Node + the facilitator only (no new deps without saying so).

## Claims we will and won't make
Will: memory snapshots are sealed on 0G Storage and anchored on Galileo by the owner; aggregate claims are
recomputable from the sealed records by an authorized auditor; version comparisons come from deterministic
re-execution with config hashes. Won't: "the model was certified", "the memory is private from everyone"
(0G Storage roots/sizes are public), "agent identity is TEE-backed" (ERC-8004 is an owner-controlled NFT).

## Order of work
1. B + A in the kinematic world (memory, snapshots, registry, regression campaign v1.0 → v1.1). Evidence.
2. C: claims on Arkiv + dashboard + auditor verify + `/arkiv/*.md`.
3. D: perception agent as a paid x402 service, signed A2A, HCS log (after the paid-CARLA work lands, same files).
4. Optional: CARLA regression for PDM-Lite versions; World ID gate on "publish release claim".
