# Faultline live verification matrix (spec §10)

Run on 2026-11-07 (local IST; timestamps below are UTC, 2026-11-06T19:xx–20:xxZ). Inference on the 0G **mainnet**
Router (`https://router-api.0g.ai/v1`, private tier); storage and chain on **0G Galileo** (16602). Simulator: CARLA
0.10.0, Town10HD_Opt. Every row is green unless marked otherwise.

| # | Test | Command / method | Result | Evidence |
|---|---|---|---|---|
| T1 | Model availability | `curl -s https://router-api.0g.ai/v1/models` | `0gm-1.0-35b-a3b` `verifiability: TeeML`, `provider_count: 1` (2026-11-06T20:15Z) | this file |
| T2 | Real decision (route A) | `python -m faultline run --world carla --seed 7 --out runs/demo-002 --anchor` | 8/8 checkpoints answered HTTP 200 with a valid action; actions change the lead's control (4× `BRAKE_HARD` then `MAINTAIN`); CCS 1.0 vs 0.094 for the scripted baseline. Route B (`laya`) dropped after spec §2.1 | `faultline-e2e-002.log`, `faultline-demo-001.log`, `faultline-baseline-001.log` |
| T3 | Trace | same run | every 0G decision has `x_0g_trace.request_id`, `provider` `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`, and `Zg-Res-Key` (e.g. cp0 `ffa55e0f-03b9-420e-87e0-853b5fa2c2e4`) | `faultline-e2e-002.log` |
| T4 | Private routing, no downgrade | private header + 0GM (all runs); private header + standard-only `deepseek-v4-flash` | 0GM: 200 on every call. Standard-only model: **503 `no_provider_for_trust_mode`** (2026-11-06T20:15:44Z). The client never retries on another tier or model (test `test_never_changes_model_or_tier`) | this file, `tests/python/test_router.py` |
| T5 | Independent verification | `npm run faultline -- verify <publicRoot>` → Compute SDK 0.9.0 `processResponse(provider, Zg-Res-Key)`, random wallet, `https://evmrpc.0g.ai` | demo-002 **8/8 true**, demo-001 **8/8 true** | `runs/*/verification.json`, `faultline-e2e-002.log`, `faultline-publish-001.log` |
| T6 | Storage upload | `npm run faultline -- publish <dir>` | demo-002 public `0x03c68b42f385410a4dfabde299667490e29f2d23af5b616d9389070e4f2d7b44` (tx `0x495d13a24bc01a47aa93b7bf1e3ed59b5d850dadaa83edeaf0d96f3afa7e0770`), sealed `0x3aa3978d37b52729e36b7e252e891d990ea5701eefa855d401391ba8e1aceb6e` (tx `0xc2a5035db72c824cad5d86a3f287c809add6a2aef418c1d3d8e04c8551bded18`); demo-001 and halt-001 roots in `faultline-publish-001.log` | `faultline-e2e-002.log` |
| T7 | Storage download | `verify` downloads both roots with `downloadToBlob(root, {proof: true})`, opens the GCM envelope | `publicRootOk`, `filesOk`, `sealed.opened`, `filesHashesMatchManifest`, `chainOk`, `observationsMatchPublic` all true (demo-001, demo-002, halt-001); the static page re-downloads demo-002 in a browser | `runs/*/verification.json`, `faultline-web-demo-002.png` |
| T8 | Replay | `python -m faultline replay runs/demo-002 --world carla`; kinematic replay tests | Kinematic: trajectory sha256 identical (tolerance 0). CARLA: decisions identical, ground-truth gap and speeds diff **0.0**, CARLA recorder playback ok; LiDAR gaps differ by up to **1.27 m** between CARLA runs (ray-cast not bit-deterministic), so the CARLA trajectory hash does **not** match. Reported, not hidden | `faultline-replay-001.log`, `faultline-e2e-002.log`, `tests/python/test_replay.py` |
| T9 | Fault injection | `tests/python/test_router.py` (fake Router) and `tests/python/test_chaos_matrix.py` (CLI `--chaos timeout\|garbage\|r429\|r502`) | each → one `source: "none"` entry, SAFE_HALT, `status: interrupted`, `manifest.chaos` set; prose/out-of-set/no-request-id/503-trust also halt; no second tier or model ever requested. Real outage: `--chaos unreachable` (refused connection) → halt-001 interrupted | `faultline-halt-001.log`, pytest |
| T10 | Tenant isolation | `packages/episode/test/bundle.test.ts` on `runs/demo-002/sealed.bin` | random second key → GCM tag error, no plaintext; public JSON contains no `initial_gap_m`, no `"history"`, no `"salt"`, not the salt value | npm test |
| T11 | Chain | `forge script script/DeployRegistry.s.sol`; `--anchor` run | `EpisodeRegistry` `0x23edb2e37F9a2a2b1DAaF0514b58E278f2FFF46A` (deploy tx `0x565b039287982f5206ff86673f9d71aa387d665cac72bcd925e42ecfe8b07d38`, source verified). demo-002 `commitScenario` tx `0x7cd9a7b563802bf2630b3c98731763773cf101c93ca68325ddd8965e3ec2aefc` at block time 20:01:06Z, **before** the first 0G decision at 20:01:29.733Z; `finalizeEpisode` tx `0xd7689a465a98a3189b85f1e8d2f0bc9591350042082c3ae26737744e3d57fbf3` at 20:02:35Z; `getEpisode` roots match | `faultline-registry-deploy.log`, `faultline-e2e-002.log` |

## Test commands (2026-11-07)
- `.venv/bin/python -m pytest tests/python -q` → `37 passed, 1 skipped` (the skip is the CARLA test without `FAULTLINE_CARLA=1`)
- `FAULTLINE_CARLA=1 .venv/bin/python -m pytest tests/python/test_carla_world.py -q` → `1 passed`
- `npm test` → `# tests 74 # pass 74 # fail 0`; `npm run typecheck` clean
- `forge test --match-contract EpisodeRegistry` → `7 tests passed, 0 failed`
- `node apps/faultline-web/test/headless.mjs` → 6 PASS (fixture, 27 rows); with `--root <demo-002 public root>` → 6 PASS

## Known limits found while building (not hidden)
- **Motion in CARLA is kinematic.** Town10's 90° corners make 20 m/s physics driving leave the lane, so both cars
  follow the lane centre with CARLA physics off; longitudinal dynamics come from the same deterministic integrator as
  `KinematicWorld`. CARLA supplies the 3-D world, ray-cast LiDAR, collision sensor and recorder.
- **LiDAR blind zone at very close range.** In demo-001 the true gap reached 0.18 m while the roof LiDAR read
  1.36 m (it cannot see the lead's bumper under the ego's hood). Per-run perception error is in `metrics.json`.
- **Episodes end early when 0GM stops the lead.** demo-001/002 ended after 8 decisions (lead stopped, both cars
  stationary for 2 s). There is no accelerate action, so this is the scenario's end, not a failure.
- **The safe halt is itself demanding for this follower** (halt-001: CCS 0.999, min gap 1.46 m): the stand-in IDM
  SUT has a 0.6 s delay and 1.2 s headway.
- 0GM ignored the prompt's "keep TTC ≥ 1 s" rule (min TTC 0.50 s); the controller does not enforce it, the metric
  records it.
