# Faultline demo video: shot list

Owner: content-agent. Phase 1 = ideas (below); Phase 3 = produced clips + running order (further down).
All CARLA runs share the server on 127.0.0.1:2000 behind the flock `/tmp/faultline-carla.lock`; 0G calls are real
private-tier Router calls unless a shot says "scripted".

Env-wrapper: the swarm CLI has no environment flag, so shots 1 and 3 use a 6-line wrapper
(`env_swarm.py`, in the agent's scratchpad, not committed) that replaces `faultline.swarm.SwarmScenario` with
`cutin.with_environment(SwarmScenario(...), <env>)` and calls `faultline.smart_swarm.carla_main` (planner + tactics
layer + director + ROS + stitch). The environment is an exact menu entry (`cutin.ENVIRONMENTS`), so
`check_environment` passes and `scenario.json` records it.

## Ideas (ranked)

| # | shot | viewer sees | 0G feature | command | est. | why better than existing |
|---|---|---|---|---|---|---|
| 1 | **Rain-night 4-car swarm** | dark wet Town10, four coloured cars close a box on the AV; RViz LiDAR noisy; HMI plots | planner names an attack, 4 coordinated cars, executor JSON per checkpoint, tactics layer, weather as attack lever | `source viz/env.sh; .venv/bin/python env_swarm.py hard_rain_night --out runs/video-swarm-rainnight-001 --ros --seed 3` | ~2 min | every existing swarm clip is clear noon; first one at night/rain |
| 2 | **Live-0G A/B arena** | same site, PDM-Lite left vs cautious IDM right, each against a live 0G attacker | A/B of two stacks, live decisions | `.venv/bin/python -m faultline.stack.arena --site r7l-2s3 --stacks pdm_lite,idm_lidar --mode live --out runs/arena-live0g-video-001` (index globs `arena-*`) | ~3 min | `arena-live-20261107T003707` is actually `mode: script` (replay); live mode never run |
| 3 | **Dense-fog swarm** | fog wall; LiDAR attenuated, attackers appear late | env lever + swarm | as #1 with `dense_fog` | ~2 min | nothing in fog exists |
| 4 | **Anchored cut-in (verify segment)** | cut-in, then `sigs`/`verify` output | signatures, Galileo anchoring | `python -m faultline run --world carla --family cut_in --anchor --view --ros` | ~4 min + testnet gas | needs testnet spend approval; existing `cutin-001` is anchored and verified, reuse for the verify segment |
| 5 | **Unreachable-0G safe halt** | run-up, AWAITING_0G, every car halts, SAFE_HALT banner | fail-closed | `ZG_ROUTER_URL=http://127.0.0.1:1 .venv/bin/python -m faultline.smart_swarm carla --out runs/video-swarm-halt-001 --ros --seed 3` | ~1 min | existing halt clips (`halt-001`, `cutin-halt-001`) are old chase-only layout; `campaign-002/carla-01..03` stitched halts exist |
| 6 | Clear-night swarm | headlights, readable night | env lever | as #1 with `clear_night` | ~2 min | prettier than rain if rain is too dark |
| 7 | Planner `--avoid` variation | a second, differently named plan on the same seed | planner novelty | as #1 plus `--avoid "<plan name>"` | ~2 min | shows the planner invents, not replays |

## Finding: CARLA 0.10 on this server does not render weather or night

Weather is set (`carla_cutin._reset` calls `set_weather`, restored in `close()`), but the UE5 camera frames stay
clear noon: `video-swarm-rainnight-001` (hard_rain_night) and the older `carla-hunt-003/closest-view` (dense_fog)
both look like daylight. What the environment *does* change: LiDAR attenuation/dropoff/noise (sparser, noisier
cloud in RViz) and friction (mu 0.5 rain-night, 0.7 fog). So in the video, say "weather acts on the LiDAR and the
road friction"; never claim the picture shows night/fog. Shot 6 (clear night) dropped for this reason; shot 4
(anchored run) not re-run: it needs testnet gas, which was not authorised, and `cutin-001` is already anchored and
verified (commit `0x8ba47d24…f633a`, finalize `0x34fae933…64f6`, `verification.json`: publicRootOk, chainOk,
metricsRecomputedOk, signaturesAllTrue all true).

## Produced clips (2026-11-07, all real private-tier 0G decisions unless noted)

| clip | run / `videos/` name | dur | best cut | on screen | 0G | sigs | metrics (ground truth) |
|---|---|---|---|---|---|---|---|
| **A. Fog swarm, tactics layer** | `runs/video-swarm-fog-001/stitched.mp4` · `videos/video-swarm-fog-001__stitched.mp4` | 32 s | 0:00–0:04 planner card "Decoy Cut-In"; **0:12–0:24 swarm squeezes, AV brakes to 7 m/s², TTC dips near 1.5 s line, LiDAR gap tracks GT**; 0:28–0:32 result card | director + RViz LiDAR (visibly sparser: dense_fog attenuation) + HMI plots; executor JSON cards with BRAKE_PULSE / SLOW_ROLL / TAILGATE / PULL_AWAY | plan req `bc8f4c70-ff4a-43c9-b6af-78a214fbf6cb`; 10 executor calls (`90c94202…` … `ba392a05…`) | 10/10 (first pass 9/10: cp0 `null`, re-run 10/10) | CCS 0.59, no collision, min TTC 1.65 s, min gap 3.5 m, max decel 6.99 m/s² |
| **B. Rain-night swarm** | `runs/video-swarm-rainnight-001/stitched.mp4` · `videos/video-swarm-rainnight-001__stitched.mp4` | 32 s | 0:06–0:16 JSON cards (C BLOCK_ALONGSIDE, D TAILGATE, B decoy); 0:20–0:26 box formed around ego | plan "Decoy Cut-In Squeeze"; picture is daylight (see finding) | plan req `2031d6a6-f925-4a03-b82a-a6657b500fa9`; 10 calls (`751da27f…` … `1a55e083…`) | 10/10 | CCS 0.01: AV never had to brake (attack failed, honest negative) |
| **C. Live-0G A/B arena** | `runs/arena-live0g-video-001/r7l-2s3__side_by_side.mp4` · `videos/arena-live0g-video-001__r7l-2s3__side_by_side.mp4` | 12 s | 0:03–0:10 cut-in; at 0:09 left PDM-Lite gap 4.8 m brake 0, right IDM brake 1.0 | PDM-Lite (left) vs cautious IDM 1.6 s (right), same site, each vs its own live attacker; old two-chase layout | 20 calls; both open CUT_IN_AGGRESSIVE, BRAKE_HARD ×2; diverge at cp 6 (vs PDM: ACCELERATE; vs IDM: BRAKE_HARD) | 10/10 + 10/10 | PDM-Lite CCS 0.90, min TTC 1.13 s, DS 82.3 · IDM CCS 0.06, min TTC 3.11 s, DS 63.1 |
| **D. Unreachable-0G safe halt** | `runs/video-swarm-halt-001/stitched.mp4` · `videos/video-swarm-halt-001__stitched.mp4` | 15 s | **0:04–0:13 red "SAFE_HALT — every car brakes (plan_failed)", HMI mode SAFE_HALT / safe_halt true** | real refused connection (`ZG_ROUTER_URL=http://127.0.0.1:1`), planner `source: none, reason: unreachable` | 0 decisions (no request) | n/a | CCS 0.90: the halt itself (all cars brake hard, ego follows to 0.4 m/s); no collision |
| **E. Live-0G A/B arena #2** | `runs/arena-live0g-video-002/r4l2s24__side_by_side.mp4` · `videos/arena-live0g-video-002__r4l2s24__side_by_side.mp4` | 12 s | 0:02–0:08 (backup for C; other traffic in frame) | as C at site r4l2s24 | 20 calls; diverge at cp 6 | 10/10 + 10/10 | PDM-Lite CCS 0.91, min TTC 1.12 s, DS 66.5 · IDM CCS 0.06, min TTC 3.12 s, DS 63.1 |

Stills checked for each (frames at 5/12/20 s and 4-second contact sheets): no frozen frames, LiDAR populated, cars on road.
The arena clip uses the older side-by-side chase layout (the arena path has no stitch step).

## Suggested 3-minute running order

1. 0:00–0:15 hook: `smart-carla-004__stitched.mp4` (existing, 4-car swarm ending in a collision, CCS 0.71).
2. 0:15–0:35 planner names the attack: clip A 0:00–0:04 + executor JSON card 0:06–0:10 ("the model's JSON, verbatim").
3. 0:35–0:60 the swarm closes in: clip A 0:12–0:24 (4 coordinated cars, AV brakes hard, TTC plot).
4. 0:60–1:15 weather as a lever: clip A RViz strip vs clip B RViz strip (sparser fog cloud); voice: LiDAR + friction, not visuals.
5. 1:15–1:45 A/B: clip C 0:03–0:10 (same attacker brain, two stacks, live; PDM-Lite pushed to TTC 1.13 s).
6. 1:45–2:05 fail-closed: clip D 0:04–0:13.
7. 2:05–2:40 verify: `npm run faultline -- sigs` output (10/10 on every run above) + `cutin-001` anchored commit/finalize + verification.json (existing `cutin-001__chase.mp4` 0:05–0:20 as b-roll).
8. 2:40–3:00 close on `swarm-carla-010__stitched.mp4` (CCS 0.90) or clip A result card.
