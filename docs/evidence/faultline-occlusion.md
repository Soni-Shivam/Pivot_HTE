# LiDAR-occlusion robustness, cut-in episode `runs/cutin-001` (2026-11-07)

`python -m faultline occlusion runs/cutin-001 --seed 0` → `runs/cutin-001-occlusion/summary.json`, log
`faultline-occlusion-001.log`. **Replayed decisions**: the adversary re-executes the 10 actions that
`0gm-1.0-35b-a3b` chose in cutin-001 (CUT_IN_AGGRESSIVE, BRAKE_HARD ×4, ACCELERATE ×2, SLOW_DOWN, BRAKE_HARD ×2);
no new 0G call was made, every replayed entry is labelled `source: "replayed"`. The adversary's motion depends only on
its own actions, so it is identical in every row; only the ego's LiDAR changes, before it reaches the tracker and
PDM-Lite (and the corridor gap that feeds the LiDAR metrics). Outcome columns are ground truth.

Conditions (frozen in `faultline/occlusion.py`, committed before cutin-001 was run): random point dropout
p ∈ {0, 0.25, 0.5, 0.75, 0.9} (numpy `default_rng(seed + i)`, seed 0, i = row index), and a blackout of the sector
3°–60° left of the sensor axis, the side the cut-in comes from (at cut_in_v1's 12–20 m gaps the adjacent-lane car
spans ~7–20° left; its near edge drops below 3° only once it is inside the ego lane corridor).

| condition | collision | min GT gap in path (m) | min GT TTC (s) | GT CCS | car tracked from (s) | in ego-lane corridor on LiDAR from (s) | GT in path from (s) | mean / max LiDAR gap error (m) | PDM-Lite max decel (m/s²) |
|---|---|---|---|---|---|---|---|---|---|
| dropout 0.00 | no | 3.50 | 1.11 | 0.908 | 0.15 | 2.30 | 2.50 | 0.11 / 3.81 | 7.06 |
| dropout 0.25 | no | 3.50 | 1.13 | 0.901 | 0.15 | 2.30 | 2.50 | 0.11 / 3.81 | 7.07 |
| dropout 0.50 | no | 3.50 | 1.16 | 0.882 | 0.15 | 2.35 | 2.50 | 0.09 / 3.20 | 7.07 |
| dropout 0.75 | no | 3.50 | 1.13 | 0.901 | 0.15 | 2.35 | 2.50 | 0.09 / 3.25 | 7.07 |
| dropout 0.90 | no | 3.50 | 1.15 | 0.888 | 0.15 | 2.35 | 2.50 | 0.10 / 3.79 | 7.07 |
| sector left 3°–60° | no | 3.49 | 1.15 | 0.892 | **2.45** | 2.35 | 2.50 | 0.12 / 4.10 | 7.07 |

(The original live run, cutin-001, has the same outcome as the dropout-0.00 row: GT min TTC 1.11 s, CCS 0.908.)

## Reading

- **No condition changed the outcome.** Collision never, minimum in-path gap 3.49–3.50 m, minimum TTC 1.11–1.16 s,
  CCS 0.88–0.91; the spread is CARLA physics run-to-run noise of the same order as the dropout rows among themselves.
- **Dropout up to 90% does not matter here** because the sensor is dense (64 channels, 1.2 M points/s): at the
  4–20 m ranges of this encounter 10% of the returns still leave tens of points on the car, enough for the tracker
  (≥ 3 points per cluster) and the corridor gap (≥ 3 points). This says nothing about sparser sensors or longer ranges.
- **The sector blackout hid the adjacent-lane car for 2.3 s** (first track at 2.45 s instead of 0.15 s) but not its
  entry into the ego lane: the near edge crosses into the unblocked 0–3° wedge at the same moment it enters the
  corridor (2.35 s vs 2.30 s), still before the ground-truth footprint overlap (2.50 s). PDM-Lite does not react to a
  car in the next lane anyway (it is neither a leader nor on a colliding forecast while it drives straight), so
  losing that track costs nothing in this episode.
- **What made the episode critical is the in-lane braking after the cut-in**, straight ahead of the sensor, which no
  condition occluded. A cut-in that brakes during the lane change, or one from a shorter gap, would test the blind
  sector harder; that needs a new 0G episode, not a replay.
- **Gap error peaks during the lane change** (max 3.8 m at t = 2.30 s, below 0.5 m from 2.6 s on): while the car is
  crossing at up to ~36° the first returns inside the corridor are on its side, ahead of the rear bumper the ground
  truth measures. The mean error over all in-corridor scans is 0.09–0.12 m.

Limits: one episode, one decision sequence, one seed per dropout level; CARLA's ray-cast LiDAR has no noise model,
weather, or material dropout; the adversary is kinematic. Replay is open-loop for the adversary (it does not
re-decide against the degraded ego), which is the point of the experiment but means these rows are not 0G decisions.
