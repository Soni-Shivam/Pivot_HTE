`pdm_lite.py` is vendored (MIT, `LICENSE-carla_garage`) from autonomousvision/carla_garage, branch `leaderboard_2`,
commit `48e6a6dbcb133220333bd65e242fbc2b492bb15b`:

- `team_code/autopilot.py` `AutoPilot` (PDM-Lite): `_get_control` (reduced), `_compute_target_speed_idm`,
  `predict_other_actors_bounding_boxes`, `compute_target_speed_wrt_leading_vehicle`,
  `compute_target_speeds_wrt_all_actors`, `get_brake_and_target_speed`, `forecast_ego_agent`, the OBB test
- `team_code/kinematic_bicycle_model.py`, `team_code/lateral_controller.py` (`LateralPIDController`),
  `team_code/longitudinal_controller.py` (`LongitudinalLinearRegressionController`): unchanged logic
- `team_code/privileged_route_planner.py`: `run_step`, `compute_rotation_angles`, `smooth_and_supersample`,
  `compute_leading_vehicles`, `compute_trailing_vehicles`
- `team_code/config.py`: the constants these read, values unchanged

Every change is marked `# faultline:` in the source. Removed: Leaderboard harness, CarlaDataProvider, data logging,
nav_planner, route-obstacle scenarios, walkers, traffic lights, stop signs, junction speed cap, steering noise, the
170-tick "blocked -> full throttle" workaround. Replaced: the simulator's actor list by LiDAR tracks
(`lidar_tracker.py`, ours), scipy RK45 by one Euler step, interp1d by np.interp, the speed-limit lookup by an injected
target speed. `lidar_tracker.py` is original Faultline code.
