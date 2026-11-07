# Faultline stack bridge: evidence (2026-11-07)

Code: `faultline/stack/` (contract `interface.py`, adapters `adapters.py`, checker `check.py`, mission `mission.py`,
sites `sites.py` + `sites_town10.json`, world `world.py`, arena `arena.py`, ROS example `ros_node.py`), guide
`docs/INTEGRATE_YOUR_STACK.md`, tests `tests/python/test_stack.py` (11 pass; suite 157 passed, 4 skipped).

All CARLA runs below use **a replayed adversary script, no 0G calls**: the accepted actions of the anchored
`runs/cutin-002` (CUT_IN_AGGRESSIVE, BRAKE_HARD, BRAKE_HARD, KEEP_LANE, ACCELERATE, BRAKE_HARD), then KEEP_LANE,
labelled `source: replayed` in every decision log. The live-0G arena mode is implemented but **was not run** (time).

## Checker output (`python -m faultline.stack check stacks/pdm_lite.yaml`, live CARLA 0.10 blueprint library)

```
stack pdm-lite-lidar (adapter python)
  [OK  ] sensor LIDAR (lidar): rate 20 Hz -> every tick (dt 0.05 s)
  [OK  ] sensor LIDAR (lidar): sensor.lidar.ray_cast present in the live blueprint library, 6 attributes checked
  [OK  ] sensor SPEED (odometry): rate 20 Hz -> every tick (dt 0.05 s)
  [OK  ] control interface: 40/40 steps returned Control(throttle, brake, steer) in range
  [OK  ] reacts to the synthetic closing lead: brakes at step 4
  [OK  ] latency: p50 2.7 ms, p95 3.5 ms, max 3.8 ms vs budget 100 ms
  [OK  ] determinism: two fresh instances, same inputs -> identical controls
  [OK  ] stack artifact digest: 0x537db480f1840d95832fa2b2bd855075ad45b5f4cafb7b64f9eed6c2dd266bba over 3 files
  RESULT: COMPATIBLE  digest 0x537db480f1840d95832fa2b2bd855075ad45b5f4cafb7b64f9eed6c2dd266bba
```
`stacks/idm_lidar.yaml`: COMPATIBLE, digest `0x7a2bf614…0097`. `stacks/ros2_pdm_lite.yaml` against the ROS node
(no CARLA): COMPATIBLE, 40/40 controls over ROS, 1 first-step timeout (braked), determinism WARN (ROS timing).

## Sites (live scan of Town10HD_Opt, `python -m faultline.stack.sites`)

| id | road / lane (left) | width | straight, junction-free | obstacles in either lane |
|---|---|---|---|---|
| r7l-2s3 | 7 / -2 (-1) | 3.5 m | 92 m | none |
| r10l-2s64 | 10 / -2 (-1) | 3.5 m | 90 m | none |
| r1l2s42 | 1 / 2 (1) | 3.5 m | 88 m | none |
| r4l2s24 | 4 / 2 (1) | 3.5 m | 90 m | none |

## A/B arena, identical adversary script: `runs/arena-script-001/compare.md`

Mission: 70 m along the route in 12 s, 30 km/h limit, same-direction lanes. Driving score = completion × penalty.

| site | stack | completion % | driving score | success | collision | CCS (gt) | min TTC s | min gap m | max decel | comfort |
|---|---|---|---|---|---|---|---|---|---|---|
| r7l-2s3 | pdm-lite-lidar | 60.3 | 60.3 | no | no | 0.908 | 1.11 | 3.50 | 7.06 | 0.665 |
| r7l-2s3 | idm-1.6s-lidar | 60.7 | 60.7 | no | no | 0.056 | 3.11 | 3.20 | 7.21 | 0.641 |
| r10l-2s64 | pdm-lite-lidar | 60.3 | 60.3 | no | no | 0.895 | 1.14 | 3.49 | 7.02 | 0.605 |
| r10l-2s64 | idm-1.6s-lidar | 60.7 | 60.7 | no | no | 0.059 | 3.17 | 3.19 | 7.20 | 0.615 |
| r1l2s42 | pdm-lite-lidar | 60.2 | 60.2 | no | no | 0.888 | 1.15 | 3.59 | 6.96 | 0.600 |
| r1l2s42 | idm-1.6s-lidar | 60.7 | 60.7 | no | no | 0.056 | 3.19 | 3.18 | 7.20 | 0.641 |
| r4l2s24 | pdm-lite-lidar | 60.3 | 60.3 | no | no | 0.909 | 1.11 | 3.49 | 7.00 | 0.631 |
| r4l2s24 | idm-1.6s-lidar | 60.7 | 60.7 | no | no | 0.055 | 3.12 | 3.20 | 7.22 | 0.632 |

Reading: the script cuts in and then brakes the adversary to a standstill in the ego lane, so neither stack can
reach the goal (the episode ends when both cars have stood still 2 s; neither stack changes lanes): mission failed,
~60 % completion, no infraction. The difference is the safety margin: IDM with 1.6 s headway keeps min TTC ≈ 3.1 s
(CCS 0.06), PDM-Lite lets it drop to ≈ 1.1 s (CCS ≈ 0.9). Results are consistent across all four sites (and with
the original cutin-002 on road 7: min TTC 1.11 s, CCS 0.93).

## ROS 2 path in CARLA: `runs/arena-ros-001`

`stacks/ros2_pdm_lite.yaml` on r4l2s24 with `faultline/stack/ros_node.py` as the external stack (only ROS messages
cross; Ackermann control converted locally): completed, completion 59.7 %, driving score 59.7, no collision, min TTC
1.15 s, CCS 0.885; 191 steps, p50 24.6 ms, **1 stack timeout** (first step, braked).

## Videos (sim-clocked, one frame per tick, HUD burned in)

* side-by-side 1920×1080: `runs/arena-script-001/{r7l-2s3,r10l-2s64,r1l2s42,r4l2s24}__side_by_side.mp4`
* per run: `runs/arena-script-001/<site>__<stack>/screen.mp4`, `runs/arena-ros-001/r4l2s24__ros2_pdm_lite/screen.mp4`,
  smoke run `runs/stack-smoke-001/r7l-2s3__pdm_lite/screen.mp4`
* (`scripts/video_index.py` indexes only `runs/*/screen.mp4`, so these nested videos are listed here, not in INDEX.md.)

## Known limits

* Live-0G A/B (`--mode live`) not run. No paid job yet binds the new multi-file digest (one-line change in the guide).
* `EgoState.wheelbase_m` read 0.0 from CARLA 0.10 wheel locations (only used by the Twist conversion); fix pending.
* The MBRDI repo turned out to be the `e2e-core` package itself; nothing was reused from it (hard rule).
