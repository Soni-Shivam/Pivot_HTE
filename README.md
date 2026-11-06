# Faultline

**An adversarial lead vehicle for autonomous-driving tests, whose every maneuver is decided by a model running on
0G's private compute, logged on 0G Storage with a request ID and a provider signature per decision, and committed on
0G Galileo before the test runs and after it ends.**

Built for the ETHGlobal 0G "Physical AI" track. A CARLA 0.10 car drives behind a lead car. Once per simulated second
the lead car asks `0gm-1.0-35b-a3b`, on the 0G Router's **private tier** (TeeML), which maneuver makes the encounter
most demanding: `MAINTAIN`, `COAST`, `BRAKE_SOFT` or `BRAKE_HARD`. Local code owns every physics step and the limits.
If 0G cannot answer, the lead performs a real safe stop and the run is marked interrupted; no decision is ever faked.
The follower's LiDAR measures the gap, and TTC, THW, DRAC and a combined criticality score (CCS) are computed from
it. A static page lets anyone check the result without an account or a key.

## Why 0G is the referee

Nobody trusts anyone's safety benchmark, because the referee always has a stake: an OEM will not accept a
competitor's adversary, and a benchmark vendor (us) could tune the adversary or quietly rerun until the number looks
right. Faultline puts the adversary's brain on 0G's private compute, where neither we nor the customer can steer it
mid-run. Every decision is signed by the provider's TEE key and the signature is archived at publish, re-checkable offline against the signer on 0G chain; the log sits on 0G Storage
where neither party hosts it, and the test is committed on chain before the first decision and the result after the
last. The customer keeps its driving stack; the referee is the network. 0G proves the decisions and the record, not
the physics: the simulator still runs on our machine (see [Limits](#limits)).

## Evidence (live, 2026-11-07)

### Current runs (EpisodeRegistryV2, signature archive, commit-block nonce, scenario reveal)

| | |
|---|---|
| `EpisodeRegistryV2` (Galileo) | [`0xeE2260cE4835059F0e0f1FB9C9948Ca5a7d4b5A4`](https://chainscan-galileo.0g.ai/address/0xeE2260cE4835059F0e0f1FB9C9948Ca5a7d4b5A4) (deploy tx `0xb7ab683b…5849`, source verified); evaluator `0x8dac3a1f…1069` record: 3 committed, 2 completed, 1 interrupted, 0 aborted |
| Anchored episode `runs/demo-003` (lead brake, CARLA) | 8 decisions by `0gm-1.0-35b-a3b`, each with a request ID and a provider signature **archived at publish, re-checkable offline** (8/8 ✓, scheme `zg-sig-v1/e2ee-ct`); every prompt carried `blockhash(commitBlock)` and all 8 answers echoed nonce `ec4a0e6c`; CCS 1.0 (red), min TTC 0.50 s, no collision; browser replay of the ground truth bit-exact |
| demo-003 public / sealed root | `0x69a532d1bb89d02b43111558a338bbe0a42549f5d1c5d28302226d9a0c626a89` / `0x0194c8000b53603b8c91bf878f2e57947f7032f2e707f48e9f48da6372ca8064` |
| demo-003 commit / finalize | [`0x7c905fca…0957`](https://chainscan-galileo.0g.ai/tx/0x7c905fca200f3be3ffec43b4c130276836ea854a6f14eccced4e111991590957) (block 64237567) / [`0x97b65582…fbf3`](https://chainscan-galileo.0g.ai/tx/0x97b65582c33288c111bd3d030c56fc396798f0a4b31ba6902bbd4150fa0ffbf3); scenario and result commitments recompute from the revealed scenario and salt |
| Anchored episode `runs/cutin-002` (cut-in, CARLA, PDM-Lite) | 6 accepted 0G decisions (CUT_IN_AGGRESSIVE, BRAKE_HARD ×2, KEEP_LANE, ACCELERATE, BRAKE_HARD), signatures 6/6 ✓; the 7th answer **omitted the nonce → `bad_nonce` SAFE_HALT** (`status: interrupted`), exactly as specified; no collision, ground-truth min TTC 1.11 s, CCS 0.93 |
| cutin-002 public / sealed root | `0x145936a81617533065583187dd7f363c7cd0adda13ed7b8576e184bf8b7d8a4f` / `0x79012dd14967af3a6f8154af7b99a28991945fe04b44af49da462161361757d6` |
| cutin-002 commit / finalize | [`0xd5f10472…9a4e`](https://chainscan-galileo.0g.ai/tx/0xd5f104724b075cb71bde25bf239ad557c3281d025a7cbdaf3f1b0fbf5eac9a4e) / [`0xa9da9d25…26af`](https://chainscan-galileo.0g.ai/tx/0xa9da9d250f61ae5b4222c9eeded7f4a93a1f7c2bb05a206eaa22766b28cd26af) |
| Adversary identity (ERC-8004) | agentId **579** on the Galileo Identity registry `0x8004A818…4BD9e` (tx `0x84974f06…67fa`), registration file on chain (`docs/evidence/faultline-erc8004.log`) |

Page screenshots: [`faultline-web-demo-003.png`](docs/evidence/faultline-web-demo-003.png),
[`faultline-web-cutin-002.png`](docs/evidence/faultline-web-cutin-002.png). Both runs record `git_dirty: true`: another
teammate's uncommitted edits to `faultline/hunt.py` / `experiment.py` (not on the run path) were in the shared tree.

### Earlier runs (EpisodeRegistry v1; signatures can no longer be re-fetched)

demo-002 and cutin-001 were checked with `processResponse` within the provider's ~20 min signature cache; that check
cannot be repeated now (the page honestly shows signatures ✗ 0/N for them), and they carry no reveal or nonce.

| | |
|---|---|
| Anchored episode `runs/demo-002` | 8 decisions by `0gm-1.0-35b-a3b`, each with a request ID; `processResponse === true` at the time (not re-checkable); CCS 1.0 (red), min TTC 0.50 s, no collision |
| Public root (0G Storage) | `0x03c68b42f385410a4dfabde299667490e29f2d23af5b616d9389070e4f2d7b44` |
| Sealed root (0G Storage) | `0x3aa3978d37b52729e36b7e252e891d990ea5701eefa855d401391ba8e1aceb6e` |
| `EpisodeRegistry` (Galileo) | [`0x23edb2e37F9a2a2b1DAaF0514b58E278f2FFF46A`](https://chainscan-galileo.0g.ai/address/0x23edb2e37F9a2a2b1DAaF0514b58E278f2FFF46A) |
| Commit before the first decision | [`0x7cd9a7b5…aefc`](https://chainscan-galileo.0g.ai/tx/0x7cd9a7b563802bf2630b3c98731763773cf101c93ca68325ddd8965e3ec2aefc) at 20:01:06Z; first 0G call at 20:01:29Z |
| Finalize after the last | [`0xd7689a46…fbf3`](https://chainscan-galileo.0g.ai/tx/0xd7689a465a98a3189b85f1e8d2f0bc9591350042082c3ae26737744e3d57fbf3) at 20:02:35Z; on-chain roots match |
| Real outage `runs/halt-001` | Router unreachable → one `source: "none"` entry, safe stop, `status: interrupted` |
| Scripted contrast `runs/baseline-001` | lead always `MAINTAIN` (labelled `scripted-baseline`, no 0G): CCS 0.094 |

The full T1–T11 matrix with every request ID, root and transaction is in
[`docs/evidence/faultline-matrix.md`](docs/evidence/faultline-matrix.md); the verifier page on the live root is
[`docs/evidence/faultline-web-demo-002.png`](docs/evidence/faultline-web-demo-002.png).

### Phase 2: aggressive cut-in against PDM-Lite on LiDAR (live, 2026-11-07)

Family `cut_in_v1` on Town10 road 7 (two same-direction lanes): the ego is **PDM-Lite** (carla_garage's rule-based
expert, vendored) on **CARLA physics**, seeing other vehicles only through its own LiDAR tracker; the adversary
starts 12 m ahead in the left lane at 9 m/s and 0G picks `KEEP_LANE`, `ACCELERATE`, `SLOW_DOWN`, `CUT_IN` (2.0 s),
`CUT_IN_AGGRESSIVE` (1.0 s) or `BRAKE_HARD` each second.

| | |
|---|---|
| Anchored episode `runs/cutin-001` | 10 decisions by `0gm-1.0-35b-a3b`, all `processResponse === true` at the time (not re-checkable now): CUT_IN_AGGRESSIVE at t = 2 s, then BRAKE_HARD ×4, ACCELERATE ×2, SLOW_DOWN, BRAKE_HARD ×2; no collision, ground-truth min TTC 1.11 s, min in-path gap 3.50 m, CCS 0.91, PDM-Lite peak decel 7.1 m/s² |
| Public / sealed root | `0x4e13bd176cfb48e993952fcbecb450023508a2a62da0abe63f4f004f3d09d0f2` / `0x757f419543a14acbe91aed0c1b0cc76e2b5086efadabe2ab576eb39fc0f6f7c2` |
| Commit / finalize (Galileo) | [`0x8ba47d24…633a`](https://chainscan-galileo.0g.ai/tx/0x8ba47d241a42320485b36ad37ff259f6b9f840f989b96c7308ae4769f40f633a) / [`0x34fae933…64f6`](https://chainscan-galileo.0g.ai/tx/0x34fae9334a28f46d31bf77c82b5da862a95c9e228545e40548ec436ec22864f6), on-chain roots match |
| Real outage `runs/cutin-halt-001` | refused connection → one `source: "none"` entry, adversary stops in its own lane, `interrupted` |
| LiDAR occlusion sweep | replayed decisions of cutin-001 under 0–90% point dropout and a 3°–60° left blind sector: outcome unchanged in every row; see [`docs/evidence/faultline-occlusion.md`](docs/evidence/faultline-occlusion.md) |

Logs: `docs/evidence/faultline-cutin-001.log`, `faultline-cutin-halt-001.log`, `faultline-occlusion-001.log`.
```bash
.venv/bin/python -m faultline run --world carla --family cut_in --seed 7 --out runs/my-cutin --anchor --view
```
```bash
.venv/bin/python -m faultline occlusion runs/my-cutin --seed 0
```

## How one episode runs

1. `scenario.json` (frozen `lead_brake_demo_v1`: both cars at 20 m/s, 35 m gap, μ 0.8, 30 s horizon) and a
   preliminary manifest are written; `commitScenario(episodeId, keccak256(salt, sha256(scenario.json)))` is mined on
   Galileo **before** the first inference (`--anchor`).
2. 3 s run-up, then a checkpoint every 1.0 s of simulated time. The simulator pauses while 0G answers.
3. The observation (gap, speeds, TTC, THW, friction; nothing else) goes to the Router with
   `X-0G-Provider-Trust-Mode: private`, JSON mode, temperature 0, 8 s timeout, one retry only after HTTP 429.
4. A valid action maps to a fixed deceleration in code. Anything else (timeout, refused connection, 429 twice, 5xx,
   503 `no_provider_for_trust_mode`, no request ID, prose, an action outside the set) → **SAFE_HALT**: the lead brakes
   at 3 m/s² to a stop, the entry is logged with `source: "none"`, and no further 0G calls are made.
5. Every decision is appended to a hash-chained `decisions.jsonl` (request ID, provider, `Zg-Res-Key`, latency, raw
   response hash, observation hash). Every 50 ms tick goes to `trajectory.jsonl` with the LiDAR gap and the metrics.
6. After the loop: each provider signature `{text, signature}` is fetched and archived (the provider caches them only
   ~20 min), a sealed bundle (AES-256-GCM envelope, per-episode key HKDF(tenant key, episode id)) and a public JSON
   (no observations, history or model text; it reveals `scenario.json` and the commitment salt) go to 0G Storage;
   `finalizeEpisode(publicRoot, sealedRoot, resultCommitment, status, collision)` is mined on EpisodeRegistryV2.
   Before the loop, `commitScenario(episodeId, scenarioCommitment, configHash)` was mined and the commit block's hash
   was put into every prompt; an answer that does not echo its nonce is a failure (`bad_nonce` → SAFE_HALT).

## Setup from a fresh clone

Needs Linux, an NVIDIA GPU for CARLA, Node 22 (via nvm), Python 3.12, Foundry.

```bash
git clone <this repo> && cd eth_hackathon && git checkout build/faultline
```
```bash
. ~/.nvm/nvm.sh && npm ci
```
```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-sim.txt
```
`requirements-sim.txt` installs the CARLA wheel from `~/carla/Carla-0.10.0-Linux-Shipping/PythonAPI/carla/dist/`.
Start CARLA once (headless) and leave it running on `127.0.0.1:2000`:
```bash
cd ~/carla/Carla-0.10.0-Linux-Shipping && nohup ./CarlaUnreal.sh -RenderOffScreen -quality-level=Low -nosound > /tmp/carla-server.log 2>&1 &
```
Copy `.env.example` to `.env` and fill `ZG_ROUTER_URL` (`https://router-api.0g.ai/v1`), `ZG_API_KEY` (pc.0g.ai),
`RPC_URL` (`https://evmrpc-testnet.0g.ai`), `STORAGE_INDEXER` (`https://indexer-storage-testnet-turbo.0g.ai`),
`PRIVATE_KEY` (a funded Galileo key) and `FAULTLINE_TENANT_KEY` (`openssl rand -hex 32`).

## Commands

Live episode with 0G decisions, anchored and published (spends Router cents and Galileo gas); `--view` opens a
chase-camera window on display `:2` and records `screen.mp4`:
```bash
.venv/bin/python -m faultline run --world carla --seed 7 --out runs/my-run --anchor --view
```
Real outage (the Router URL becomes a closed local port) and the scripted contrast run:
```bash
.venv/bin/python -m faultline run --world carla --seed 42 --chaos unreachable --out runs/my-halt
```
```bash
.venv/bin/python -m faultline run --world carla --seed 42 --decider maintain --out runs/my-baseline
```
Replay the recorded decisions on a fresh world (and play the CARLA recorder log), or check a published episode:
```bash
.venv/bin/python -m faultline replay runs/demo-003 --world carla
```
```bash
npm run faultline -- verify 0x69a532d1bb89d02b43111558a338bbe0a42549f5d1c5d28302226d9a0c626a89
```
Verifier page (static, no backend), then open `http://localhost:5174/?root=<publicRoot>`. `dist/` also works from
any static https host: every request is https (0G indexer `/file`, Galileo RPC, 0G mainnet RPC) and the CSP allows only
`connect-src https:`. It checks Merkle root, file hashes, metrics, archived signatures, the V2 commitments (reveal,
config hash, commit-block nonce, evaluator record) and replays lead-brake episodes bit-exactly in the browser:
```bash
npm run fweb:build && npm run fweb:serve
```
Tests:
```bash
.venv/bin/python -m pytest tests/python -q
```
```bash
npm test && npm run typecheck
```
```bash
cd contracts && forge test --match-contract EpisodeRegistry
```
CARLA world test (needs the server) and the headless page test (uses Playwright; on a machine without a global copy
set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`):
```bash
FAULTLINE_CARLA=1 .venv/bin/python -m pytest tests/python/test_carla_world.py -q
```
```bash
node apps/faultline-web/test/headless.mjs
```
`--chaos timeout|garbage|r429|r502` uses an in-process fake Router for the fault matrix; such runs print
`CHAOS MODE` and carry `manifest.chaos`, so they can never pass as evidence.

## Code map

| Path | What |
|---|---|
| `faultline/` | Python: scenario, IDM follower, lead controller, `KinematicWorld`, `CarlaWorld`, LiDAR perception, 0G Router client, episode loop + safe-halt state machine, hash-chained log, replay, CLI, chase-camera viewer |
| `faultline/metrics/` | TTC / THW / DRAC and CCS v2, vendored (MIT) from MBRDI, see `ATTRIBUTION.md` |
| `faultline/ego/` | PDM-Lite vendored (MIT) from carla_garage + our LiDAR tracker; `cutin.py`, `carla_cutin.py`, `occlusion.py` |
| `packages/episode/` | TypeScript: public/sealed bundles, 0G Storage publish, archived TEE signature checks, browser replay, Galileo anchoring (EpisodeRegistryV2), CLI |
| `contracts/src/EpisodeRegistryV2.sol` | commit-before / finalize-after registry keyed by evaluator, with per-evaluator stats (Foundry, Galileo; v1 `EpisodeRegistry.sol` kept for old runs) |
| `apps/faultline-web/` | static verifier and replay page |
| `docs/evidence/` | logs, roots, request IDs, transactions, screenshots |

## What we claim, and what we do not

We claim: each lead maneuver in an anchored episode was decided by `0gm-1.0-35b-a3b` on 0G's private tier, with a
request ID and a provider TEE signature archived at publish and re-checkable offline against the signer on 0G chain
(it shows the provider's enclave answered that chat; it does not bind the logged text, because the Router seals the
turn end to end and the signature covers its ciphertext, see `docs/faultline-audit.md` A2); each accepted answer
echoed a nonce from the commit block's hash; prompts were served on the private tier and a 503
halts the run with no fallback; the log is on 0G Storage and downloads with a Merkle proof; replaying the recorded
decisions reproduces the ground-truth trajectory exactly; the scenario was committed on Galileo before the first
inference and the result after. CCS is a criticality score, not an accident probability.

We do not claim: "verified safe", "certified", "trustless", "tamper-proof", that nobody can see the observations (the
enclave sees them), that the simulation itself is proven honest, or anything about a real vehicle.

## Limits

- The simulator and the stand-in driver (an IDM follower with 0.6 s reaction delay, not a production AV stack) run on
  our machine. 0G referees the decisions and the record, not the physics. An attested evaluator (0G-TAPP or the
  sealed sandbox) is the roadmap.
- In CARLA both cars follow the lane centre with physics off; longitudinal motion comes from the same deterministic
  integrator as `KinematicWorld` (Town10's 90° corners make 20 m/s physics driving leave the lane). CARLA supplies
  the 3-D world, the ray-cast LiDAR the metrics come from, the collision sensor and the recorder.
- CARLA's LiDAR is not bit-deterministic: a CARLA replay reproduces decisions, ground-truth gap and speeds exactly,
  but LiDAR gaps differ by up to ~1.3 m, so the CARLA trajectory hash differs (the kinematic replay is bit-exact).
- The roof LiDAR has a blind zone under ~1.5 m (demo-001: true gap 0.18 m, LiDAR 1.36 m). Per-run perception error
  is published in `metrics.json`.
- Episodes end when both cars have stopped for 2 s; there is no accelerate action, so a run where 0GM stops the lead
  ends early (8 decisions in demo-001/002).
- Inference runs on 0G **mainnet**; storage and the registry on **Galileo testnet**. Archived signatures are
  re-checked in the CLI and in the browser against the signer read from 0G mainnet.
- Content binding is open (audit A2): the provider signs `zg-sig-v1/e2ee-ct:<sha256 of the Router's sealed request>:
  <… sealed response>`, bytes only the Router holds. The nonce echo is enforced by our parser, not by the signature.
- The browser replay covers the lead-brake family (bit-exact; CARLA runs: ground-truth fields only). Cut-in replay is
  Python-only.
- Observations are visible inside the TeeML enclave and, per 0G, to the Router in memory for billing.
- One synthetic tenant; tenant isolation is shown with a second random key.
- Cut-in (phase 2): PDM-Lite is vendored with walkers, traffic lights, stop signs, the junction speed cap and
  Leaderboard workarounds removed, and its partial throttle scaled ×0.35 for CARLA 0.10 physics (see
  `faultline/ego/ATTRIBUTION.md`). The LiDAR tracker is a simple BEV clusterer with car-sized priors and a region of
  interest of the two same-direction lanes; it is not a learned detector. The adversary stays kinematic. In the
  cut-in trajectory `gt_gap` is the signed longitudinal bumper gap in every phase (adjacent lane included);
  `gt_in_path` / `gt_ttc_s` say when it matters. Public decisions carry the action, not the cut-in control fields
  (`control_accel_mps2`, `lane_change_s`), which are in the sealed log and follow from the action.

## Attribution

`faultline/metrics/` vendors `criticality_metrics/utils/kinematics.py` and `metrics/composite_scorer_v2.py` from
SeDriCa/MBRDI-Development @ 030e5df (MIT). The previous SealedAI product (packages `planner`, `worker`, `client`,
`apps/web`, escrow contracts) remains in the repository for reference; see `docs/PLAN.md`.
