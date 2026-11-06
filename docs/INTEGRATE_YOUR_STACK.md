# Integrate your AV stack with Faultline

Faultline owns the **world, the adversary and the clock**. Your stack owns **the ego's decisions**. Between them
is one small contract, `AVStack` (`faultline/stack/interface.py`), and three ways to meet it.

## What your stack receives and returns

| | |
|---|---|
| once, `setup(mission, hd_map_path)` | the **Mission** (`faultline/stack/mission.py`): route (lane-centre samples, CARLA world frame, and the same in GNSS), goal distance, time limit, speed limit, target speed, lane width, allowed lateral band, dt; and the Lanelet2 map `maps/Town10HD_Opt.osm` |
| every step, `run_step(observations, ego_state, t_s)` | `ego_state`: your own pose, speed, acceleration, dimensions, max wheel angle, wheelbase (proprioception). `observations`: data **only from the sensors you declared**, in the CARLA Leaderboard `input_data` format `{id: (frame, data)}` (LiDAR `float32 (N,4)` sensor frame, camera `uint8 (H,W,4)` BGRA, GNSS `[lat, lon, alt]`, IMU `[ax, ay, az, gx, gy, gz, compass]`, odometry `{"speed"}`) |
| you return | `Control(throttle ∈ [0,1], brake ∈ [0,1], steer ∈ [-1,1])`; or, over ROS, Ackermann (speed + wheel angle [+ accel]) / Twist, converted locally (`ackermann_to_control`) |
| never | a list of other actors, their poses or intentions, ground truth, the adversary's plan, or the server: Faultline ticks CARLA synchronously at dt = 0.05 s; you never start, reload or tick it |

An out-of-range control (NaN, throttle 1.2, ...) is never applied: the ego brakes that step and the run records it
under `mission.json → stack.invalid_controls`.

## Steps for a stack owner

1. **Pick an adapter.**
   * *Python in-process*: implement `sensors() / setup() / run_step() / destroy()` on a class. Reference:
     `faultline/stack/reference.py` (`PdmLiteStack`: PDM-Lite on our LiDAR tracker; `IdmLidarStack`: IDM 1.6 s
     headway on the same perception).
   * *CARLA Leaderboard agent* (most CARLA stacks: TransFuser, InterFuser, PDM-Lite, ...): nothing to change.
     `LeaderboardAgentStack` calls your `setup(path_to_conf_file)`, `sensors()`, `set_global_plan()`,
     `run_step(input_data, timestamp)`, `destroy()` by duck typing (leaderboard is not imported). Radar and
     `sensor.opendrive_map` are not bridged yet.
   * *ROS 2* (Autoware, SeDriCa, ...): `RosStack` publishes, on `ROS_DOMAIN_ID=42` (`source viz/env.sh`), frame
     `map` = CARLA with y flipped: `/faultline/stack/<sensor id>` (`sensor_msgs/PointCloud2`),
     `/faultline/stack/odom` (`nav_msgs/Odometry`), `/tf` (map→ego), `/clock`, `/faultline/stack/route`
     (`nav_msgs/Path`, latched), `/faultline/stack/map_path` (`std_msgs/String`, latched: the Lanelet2 .osm). It
     waits up to `latency_budget_s` for one `/faultline/stack/control` message
     (`ackermann_msgs/AckermannDriveStamped` or `geometry_msgs/Twist`); none in time = **full brake that step,
     counted as a stack timeout, not a crash**. Example node: `faultline/stack/ros_node.py`.
2. **Write `stack.yaml`** (see `stacks/pdm_lite.yaml`, `stacks/ros2_pdm_lite.yaml`): `name`, `adapter`, `entry`
   (`module:Class`) or `sensors` (ROS), `config` (Leaderboard conf path), `latency_budget_s`, and `files`: the
   stack artifact whose digest is bound into the paid job.
3. **Run the checker**: `.venv/bin/python -m faultline.stack check stack.yaml`. It reports sensor types and counts
   (Leaderboard limits: 2 LiDAR, 8 cameras, 1 GNSS, 1 IMU; mount within 3 m), every declared attribute against the
   **live CARLA 0.10 blueprint library**, sensor rates vs dt 0.05 s, the control interface over N open-loop dry
   steps (seeded synthetic route + a closing car-sized point cluster), per-step latency p50/p95 vs your budget,
   determinism (two fresh instances, same inputs, identical outputs) and the **stack artifact digest**.
4. **Dry run, free**: `.venv/bin/python -m faultline.stack.arena --site seed:0 --stacks <your stack.yaml> --mode script`
   runs the cut-in on a validated site with a replayed adversary script (no 0G calls), writing the episode bundle,
   `mission.json` (route completion, infractions, driving score), ground-truth safety metrics and a chase video.
   Add a second stack to `--stacks` for an A/B comparison (`compare.md`, side-by-side video).
5. **Buy a paid job**: the Hedera permit binds `policyCommitment` = the digest from step 3
   (`python -m faultline.stack digest stack.yaml`), so the run you pay for is provably your declared artifact.
   Today `packages/hedera/src/run-paid-job.ts` line 15 hashes `faultline/ego/pdm_lite.py` alone; the one-line change is
   ```ts
   const actualPolicyCommitment = execFileSync('.venv/bin/python', ['-m', 'faultline.stack', 'digest', process.env.FAULTLINE_STACK ?? 'stacks/pdm_lite.yaml']).toString().trim()
   ```
   (single-file specs give exactly today's value: the digest of one file is its plain sha256). The same digest is
   recorded as `stack_digest` in the scenario (so in the scenario hash) and in the episode manifest; binding it into
   the Galileo `configHash` is the same one-field addition to `config` in `faultline/cli.py`.

## The ego's task (Mission) and how it is scored

The ego must drive `goal_m` (default 70 m) along the route within `time_limit_s` (= scenario horizon, 12 s), within
the speed limit (30 km/h), staying in the allowed same-direction lanes, while the adversary attacks it.
**Driving score = route completion % × infraction penalty**, the CARLA Leaderboard 2.0 composition
(`statistics_manager.py`): vehicle collision ×0.60 and outside-route-lanes ×(1 − % outside) are the Leaderboard's;
speeding (>110 % of the limit for ≥ 1 s, ×0.90 each) and "blocked" (stopped ≥ 4 s before the goal freezes route
completion) are ours. A stack that "survives" by stopping scores low. Safety metrics (CCS, TTC, gap, DRAC) are
unchanged and reported next to it.

## Sites

`faultline/stack/sites_town10.json`: validated starts on Town10HD_Opt, produced by `python -m faultline.stack.sites`
from the live map: ego lane with a same-direction driving lane on its left, equal constant widths, junction-free,
yaw drift < 4°, ≥ 60 m for the cut-in, no static obstacle in either lane (ray casts along both lane centres at 0.5 m
and 1.2 m). `--site seed:N` picks one deterministically; the site id is part of the scenario hash.

## Supported / not supported

| supported | not yet |
|---|---|
| LiDAR, RGB camera, GNSS, IMU, odometry; any blueprint attribute CARLA 0.10 has | radar, depth/semantic cameras, `sensor.opendrive_map` pseudo-sensor (use the .osm path) |
| synchronous stepping at 20 Hz; slower sensors every n-th tick (20/n Hz) | asynchronous free-running stacks without a shim |
| Python, Leaderboard-agent duck typing, ROS 2 (Ackermann/Twist) | ROS 1, Apollo Cyber RT, C++ in-process |
| cut-in family on 4 validated Town10 sites | other families/maps through the stack bridge (built-in worlds still run them) |

## Common incompatibilities and fixes

* **Async stack** (runs on its own timer, expects wall-clock sensor streams): run it through the ROS adapter with
  `use_sim_time` on `/clock`; each Faultline step publishes once and waits for one control — that is your sync shim.
  Raise `latency_budget_s` if your pipeline is slower than real time (the sim waits; only timeouts brake).
* **Different units/frames**: declare mounts in the CARLA ego frame (x forward, y right, z up, degrees); the ROS
  side gets ROS conventions (y left, radians) in frame `map`. Convert once in your adapter, not per sensor.
* **Camera-only stack**: declare `type: camera` with `image_size_x/y`, `fov`; the checker validates the attributes
  live. Note the built-in ground-side LiDAR still measures the gap for Faultline's metrics; it never reaches you.
* **Needs object lists / HD-map queries at runtime**: not provided (privileged). Use the Lanelet2 file and your own
  perception.
* **Nondeterministic stack** (threads, unseeded RNG, GPU nondeterminism): the checker warns; runs still score, but
  replays will not be bit-exact.
