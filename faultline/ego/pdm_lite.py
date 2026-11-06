"""PDM-Lite (the rule-based CARLA expert of carla_garage) as Faultline's ego, fed by LiDAR tracks instead of the
simulator's actor list.

Vendored (MIT, see LICENSE-carla_garage and ATTRIBUTION.md) from autonomousvision/carla_garage, branch leaderboard_2,
commit 48e6a6dbcb133220333bd65e242fbc2b492bb15b, team_code/{autopilot.py, kinematic_bicycle_model.py,
lateral_controller.py, longitudinal_controller.py, privileged_route_planner.py, config.py}. Method bodies are kept
as in the source; every change is marked `# faultline:`. Summary of the changes:
- no Leaderboard harness, CarlaDataProvider, logging, nav_planner, route-obstacle scenarios, walkers, traffic lights
  or stop signs (the cut-in runs on a straight two-lane segment without signals; this is disabled, not emulated)
- other vehicles are `tracks` (duck-typed objects from faultline.ego.lidar_tracker), never `world.get_actors()`
- scipy RK45 (one 0.05 s step) -> one explicit Euler step; interp1d -> np.interp; no speed-limit lookup: the target
  speed is injected by the scenario instead of 0.72 x the map limit
- no steering noise, no "blocked for 170 ticks -> full throttle" Leaderboard workaround, no junction speed cap
- the route is a list of (x, y, z) lane-centre points from our CARLA route, all RoadOption.LANEFOLLOW
"""
import math

import carla
import numpy as np


class Config:
    """The subset of carla_garage team_code/config.py GlobalConfig that the code below reads (values unchanged unless
    marked)."""
    bicycle_frame_rate = 20
    detection_radius = 50.0
    points_per_meter = 10
    idm_leading_vehicle_minimum_distance = 4.0
    idm_leading_vehicle_time_headway = 0.25
    idm_t_bound = 0.05
    idm_maximum_acceleration = 24.0
    idm_comfortable_braking_deceleration_low_speed = 8.7
    idm_comfortable_braking_deceleration_high_speed = 3.72
    idm_comfortable_braking_deceleration_threshold = 6.02
    idm_acceleration_exponent = 4.0
    high_speed_extent_factor_ego_x = 1.3
    high_speed_extent_factor_ego_y = 1.2
    extent_ego_bbs_speed_threshold = 5
    forecast_length_lane_change = 1.1
    default_forecast_length = 2.0
    slow_speed_extent_factor_ego = 1.0
    extent_other_vehicles_bbs_speed_threshold = 1.0
    high_speed_min_extent_y_other_vehicle = 1.0
    high_speed_extent_y_factor_other_vehicle = 1.3
    high_speed_min_extent_x_other_vehicle = 1.2
    high_speed_min_extent_x_other_vehicle_lane_change = 2.0
    braking_distance_calculation_safety_distance = 10
    minimum_speed_to_prevent_rolling_back = 0.5
    minimum_lookahead_distance_to_compute_near_lane_change = 20 * points_per_meter
    check_previous_distance_for_lane_change = 15 * points_per_meter
    longitudinal_linear_regression_minimum_target_speed = 0.278
    longitudinal_linear_regression_params = np.array([
        1.1990342347353184, -0.8057602384167799, 1.710818710950062, 0.921890257450335, 1.556497522998393,
        -0.7013479734904027, 1.031266635497984
    ])
    longitudinal_linear_regression_maximum_acceleration = 1.89
    longitudinal_linear_regression_maximum_deceleration = -4.82
    lateral_pid_kp = 3.118357247806046
    lateral_pid_kd = 1.3782508892109167
    lateral_pid_ki = 0.6406067986034124
    lateral_pid_speed_scale = 0.9755321901954155
    lateral_pid_speed_offset = 1.9152884533402488
    lateral_pid_window_size = 6
    lateral_pid_minimum_lookahead_distance = 2.4 * points_per_meter
    lateral_pid_maximum_lookahead_distance = 10.5 * points_per_meter
    time_step = 1. / 20.
    front_wheel_base = -0.090769015
    rear_wheel_base = 1.4178275
    steering_gain = 0.36848336
    brake_acceleration = -4.952399
    throttle_acceleration = 0.5633837
    throttle_values = np.array([
        9.63873001e-01, 4.37535692e-04, -3.80192912e-01, 1.74950069e+00, 9.16787414e-02, -7.05461530e-02,
        -1.05996152e-03, 6.71079346e-04
    ])
    brake_values = np.array([
        9.31711370e-03, 8.20967431e-02, -2.83832427e-03, 5.06587474e-05, -4.90357228e-07, 2.44419284e-09,
        -4.91381935e-12
    ])
    throttle_threshold_during_forecasting = 0.3
    ego_vehicles_route_point_search_distance = 4 * points_per_meter
    leading_vehicles_max_route_distance = 2.5
    leading_vehicles_max_route_angle_distance = 35.
    leading_vehicles_maximum_detection_radius = 80 * points_per_meter
    trailing_vehicles_max_route_distance = 3.0
    tailing_vehicles_maximum_detection_radius = 80 * points_per_meter


class KinematicBicycleModel:
    """kinematic_bicycle_model.py (unchanged)."""

    def __init__(self, config):
        self.config = config
        self.time_step = config.time_step
        self.front_wheel_base = config.front_wheel_base
        self.rear_wheel_base = config.rear_wheel_base
        self.steering_gain = config.steering_gain
        self.brake_acceleration = config.brake_acceleration
        self.throttle_acceleration = config.throttle_acceleration
        self.throttle_values = config.throttle_values
        self.brake_values = config.brake_values
        self.throttle_threshold_during_forecasting = config.throttle_threshold_during_forecasting

    def forecast_other_vehicles(self, locations, headings, speeds, actions):
        steers, throttles, brakes = actions[:, 0], actions[:, 1], actions[:, 2].astype(np.uint8)
        wheel_angles = self.steering_gain * steers
        slip_angles = np.arctan(self.rear_wheel_base / (self.front_wheel_base + self.rear_wheel_base) *
                                np.tan(wheel_angles))
        next_x = locations[:, 0] + speeds * np.cos(headings + slip_angles) * self.time_step
        next_y = locations[:, 1] + speeds * np.sin(headings + slip_angles) * self.time_step
        next_headings = headings + speeds / self.rear_wheel_base * np.sin(slip_angles) * self.time_step
        next_speeds = speeds + self.time_step * np.where(brakes, self.brake_acceleration,
                                                         throttles * self.throttle_acceleration)
        next_speeds = np.maximum(0.0, next_speeds)
        next_locations = np.column_stack([next_x, next_y, locations[:, 2]])
        return next_locations, next_headings, next_speeds

    def forecast_ego_vehicle(self, location, heading, speed, action):
        steer, throttle, brake = action
        wheel_angle = self.steering_gain * steer
        slip_angle = np.arctan(self.rear_wheel_base / (self.front_wheel_base + self.rear_wheel_base) *
                               np.tan(wheel_angle))
        next_x = location[0] + speed * np.cos(heading + slip_angle) * self.time_step
        next_y = location[1] + speed * np.sin(heading + slip_angle) * self.time_step
        next_heading = heading + speed / self.rear_wheel_base * np.sin(slip_angle) * self.time_step
        if brake:
            speed_kph = speed * 3.6
            features = speed_kph**np.arange(1, 8)
            next_speed_kph = features @ self.brake_values
            next_speed = next_speed_kph / 3.6
        else:
            throttle = np.clip(throttle, 0., 1.0)
            if throttle < self.throttle_threshold_during_forecasting:
                next_speed = speed
            else:
                speed_kph = (speed * 3.6).item()
                features = np.array([
                    speed_kph, speed_kph**2, throttle, throttle**2, speed_kph * throttle, speed_kph * throttle**2,
                    speed_kph**2 * throttle, speed_kph**2 * throttle**2
                ]).T
                next_speed_kph = features @ self.throttle_values
                next_speed = next_speed_kph / 3.6
        next_speed = np.maximum(0.0, next_speed)
        next_location = np.array([next_x[0], next_y[0], location[2]])
        return next_location, next_heading, next_speed


class LateralPIDController:
    """lateral_controller.py LateralPIDController (PDM-Lite path, inference_mode=False)."""

    def __init__(self, config):
        self.config = config
        self.error_history = []
        self.saved_error_history = []

    def step(self, route_points, current_speed, vehicle_position, vehicle_heading):
        c = self.config
        current_speed_kph = current_speed * 3.6
        lookahead_distance = c.lateral_pid_speed_scale * current_speed_kph + c.lateral_pid_speed_offset
        lookahead_distance = np.clip(lookahead_distance, c.lateral_pid_minimum_lookahead_distance,
                                     c.lateral_pid_maximum_lookahead_distance)
        lookahead_distance = int(min(float(np.squeeze(lookahead_distance)), route_points.shape[0] - 1))
        desired_heading_vec = route_points[lookahead_distance] - vehicle_position
        desired_heading_angle = np.arctan2(desired_heading_vec[1], desired_heading_vec[0])
        heading_error = (desired_heading_angle - vehicle_heading) % (2 * np.pi)
        heading_error = heading_error if heading_error < np.pi else heading_error - 2 * np.pi
        heading_error = heading_error * 180. / np.pi / 90.
        self.error_history.append(heading_error)
        self.error_history = self.error_history[-c.lateral_pid_window_size:]
        derivative = 0.0 if len(self.error_history) == 1 else self.error_history[-1] - self.error_history[-2]
        integral = np.mean(self.error_history)
        steering = np.clip(c.lateral_pid_kp * heading_error + c.lateral_pid_kd * derivative +
                           c.lateral_pid_ki * integral, -1., 1.).item()
        return steering

    def save_state(self):
        self.saved_error_history = self.error_history.copy()

    def load_state(self):
        self.error_history = self.saved_error_history.copy()


class LongitudinalLinearRegressionController:
    """longitudinal_controller.py LongitudinalLinearRegressionController (unchanged)."""

    def __init__(self, config):
        self.minimum_target_speed = config.longitudinal_linear_regression_minimum_target_speed
        self.params = config.longitudinal_linear_regression_params
        self.maximum_acceleration = config.longitudinal_linear_regression_maximum_acceleration
        self.maximum_deceleration = config.longitudinal_linear_regression_maximum_deceleration

    def get_throttle_and_brake(self, hazard_brake, target_speed, current_speed):
        if target_speed < 1e-5 or hazard_brake:
            return 0., True
        elif target_speed < self.minimum_target_speed:
            target_speed = self.minimum_target_speed
        current_speed = current_speed * 3.6
        target_speed = target_speed * 3.6
        params = self.params
        speed_error = target_speed - current_speed
        if speed_error > self.maximum_acceleration:
            return 1., False
        if current_speed / target_speed > params[-1] or hazard_brake:
            return 0., True
        speed_error_cl = np.clip(speed_error, 0., np.inf) / 100.0
        current_speed /= 100.
        features = np.array([current_speed, current_speed**2, 100 * speed_error_cl, speed_error_cl**2,
                             current_speed * speed_error_cl, current_speed**2 * speed_error_cl])
        return float(np.clip(features @ params[:-1], 0., 1.)), False

    def get_throttle_extrapolation(self, target_speed, current_speed):
        current_speed = current_speed * 3.6
        target_speed = target_speed * 3.6
        params = self.params
        speed_error = target_speed - current_speed
        if speed_error > self.maximum_acceleration:
            return 1.
        elif speed_error < self.maximum_deceleration:
            return 0.
        throttle = 0.
        if target_speed < 0.1 or current_speed / target_speed > params[-1]:
            return throttle
        speed_error_cl = np.clip(speed_error, 0., np.inf) / 100.0
        current_speed /= 100.
        features = np.array([current_speed, current_speed**2, 100 * speed_error_cl, speed_error_cl**2,
                             current_speed * speed_error_cl, current_speed**2 * speed_error_cl]).flatten()
        return np.clip(features @ params[:-1], 0., 1.)


class RoutePlanner:
    """The parts of privileged_route_planner.py PrivilegedRoutePlanner that PDM-Lite's vehicle logic uses."""

    def __init__(self, config, route_xyz):
        self.config = config
        self.points_per_meter = config.points_per_meter
        # faultline: our route is already the lane centre; only the 10 points/m resampling of smooth_and_supersample
        self.route_points = self.smooth_and_supersample(np.asarray(route_xyz, dtype=float))
        self.commands = ["LANEFOLLOW"] * len(self.route_points)  # faultline: no lane changes on our route
        self.rotation_angles = self.compute_rotation_angles(self.route_points)
        self.route_index = 0
        self.last_route_index = 0

    def localize(self, agent_position):
        """faultline: replaces the source's extra_route_length start index; global nearest route point."""
        self.route_index = int(np.argmin(np.linalg.norm(agent_position[None, :2] - self.route_points[:, :2], axis=1)))

    def save(self):
        self.last_route_index = self.route_index

    def load(self):
        self.route_index = self.last_route_index

    def run_step(self, agent_position):
        till = self.config.ego_vehicles_route_point_search_distance
        search_range = min(self.route_index + till, self.route_points.shape[0])
        self.route_index += np.argmin(np.linalg.norm(agent_position[None, :2] -
                                                     self.route_points[self.route_index:search_range, :2], axis=1))
        return self.route_points[self.route_index:]

    def compute_rotation_angles(self, route_points):
        indices = np.arange(1, route_points.shape[0] - 1)
        differences = route_points[indices + 1] - route_points[indices - 1]
        yaws = np.arctan2(differences[:, 1], differences[:, 0]) * 180. / np.pi
        return np.concatenate([[yaws[0]], yaws, [yaws[-1]]])

    def smooth_and_supersample(self, original_route_points):
        num_samples = self.points_per_meter * 10
        segment_length = 1. / self.points_per_meter
        n = original_route_points.shape[0]
        t = np.arange(0, n - 1, 1. / num_samples)
        route_supersampled = np.column_stack([np.interp(t, np.arange(n), original_route_points[:, k]) for k in range(3)])
        cumulative_distances = np.cumsum(np.linalg.norm(np.diff(route_supersampled, axis=0), axis=1))
        cumulative_distances = np.insert(cumulative_distances, 0, 0)
        cumulative_distances = cumulative_distances % segment_length
        segment_indices = np.insert(np.argwhere(cumulative_distances[1:] < cumulative_distances[:-1]), 0, 0)
        return route_supersampled[segment_indices]

    def compute_leading_vehicles(self, list_vehicles, ego_vehicle_id):
        vehicle_ids = np.array([vehicle.id for vehicle in list_vehicles if vehicle.id != ego_vehicle_id])
        if len(vehicle_ids) and self.route_index != self.route_points.shape[0]:
            max_distance = self.config.leading_vehicles_maximum_detection_radius
            vehicle_yaws = np.array(
                [vehicle.get_transform().rotation.yaw for vehicle in list_vehicles if vehicle.id != ego_vehicle_id])
            vehicle_locations = [vehicle.get_location() for vehicle in list_vehicles if vehicle.id != ego_vehicle_id]
            vehicle_locations = np.array([[loc.x, loc.y, loc.z] for loc in vehicle_locations])
            distances = vehicle_locations[:, None, :2] - self.route_points[
                None, self.route_index:self.route_index + max_distance, :2][:, ::self.points_per_meter, :]
            distances = np.linalg.norm(distances, axis=2)
            route_indices = distances.argmin(axis=1)
            distances = distances.min(axis=1)
            rotation_angles = self.rotation_angles[self.route_index:self.route_index +
                                                   max_distance][::self.points_per_meter]
            route_yaws = rotation_angles[route_indices]
            yaw_differences = (route_yaws - vehicle_yaws) % 360
            yaw_differences = np.minimum(yaw_differences, 360 - yaw_differences)
            leading = vehicle_ids[(distances < self.config.leading_vehicles_max_route_distance) &
                                  (yaw_differences < self.config.leading_vehicles_max_route_angle_distance)]
            return leading.tolist()
        return []

    def compute_trailing_vehicles(self, list_vehicles, ego_vehicle_id):
        vehicle_ids = np.array([vehicle.id for vehicle in list_vehicles if vehicle.id != ego_vehicle_id])
        max_distance = self.config.trailing_vehicles_max_route_distance  # faultline: no lane-change widening
        if len(vehicle_ids) and self.route_index != 0:
            vehicle_yaws = np.array(
                [vehicle.get_transform().rotation.yaw for vehicle in list_vehicles if vehicle.id != ego_vehicle_id])
            vehicle_locations = [vehicle.get_location() for vehicle in list_vehicles if vehicle.id != ego_vehicle_id]
            vehicle_locations = np.array([[loc.x, loc.y, loc.z] for loc in vehicle_locations])
            from_idx = max(0, self.route_index - self.config.tailing_vehicles_maximum_detection_radius)
            distances = vehicle_locations[:, None, :2] - self.route_points[
                None, from_idx:self.route_index, :2][:, ::self.points_per_meter, :]
            distances = np.linalg.norm(distances, axis=2)
            route_indices = distances.argmin(axis=1)
            distances = distances.min(axis=1)
            rotation_angles = self.rotation_angles[from_idx:self.route_index][::self.points_per_meter]
            route_yaws = rotation_angles[route_indices]
            yaw_differences = (route_yaws - vehicle_yaws) % 360
            yaw_differences = np.minimum(yaw_differences, 360 - yaw_differences)
            return vehicle_ids[(distances < max_distance) & (yaw_differences < 30)].tolist()
        return []


class PDMLite:
    """autopilot.py AutoPilot reduced to its vehicle logic. `run_step` takes the ego's own pose and speed
    (proprioception) and the LiDAR tracks; it returns a carla.VehicleControl."""

    EGO_ID = -1  # faultline: tracks never carry this id

    def __init__(self, route_xyz, ego_bounding_box, target_speed_mps: float, config=Config()):
        self.config = config
        self.target_speed = target_speed_mps  # faultline: injected, replaces min(0.72 * speed_limit, 72 km/h)
        self.ego_extent = ego_bounding_box.extent
        self.ego_model = KinematicBicycleModel(config)
        self.vehicle_model = KinematicBicycleModel(config)
        self._turn_controller = LateralPIDController(config)
        self._longitudinal_controller = LongitudinalLinearRegressionController(config)
        self._waypoint_planner = RoutePlanner(config, route_xyz)
        self.vehicle_hazard = False
        self.leading_ids = []
        self.target_speed_out = target_speed_mps
        self.localized = False

    def run_step(self, ego_transform, ego_speed: float, tracks) -> carla.VehicleControl:
        loc = ego_transform.location
        ego_position = np.array([loc.x, loc.y, loc.z])
        compass = math.radians(ego_transform.rotation.yaw)  # faultline: pose from the ego's own state, not the IMU
        if not self.localized:
            self._waypoint_planner.localize(ego_position)
            self.localized = True
        route_np = self._waypoint_planner.run_step(ego_position)
        target_speed = self.target_speed
        self._tracks = {t.id: t for t in tracks}  # faultline: replaces self._world.get_actor(id)
        brake, target_speed = self.get_brake_and_target_speed(route_np, list(tracks), ego_transform, ego_speed,
                                                              target_speed)
        self.target_speed_out = float(target_speed)
        throttle, control_brake = self._longitudinal_controller.get_throttle_and_brake(brake, target_speed, ego_speed)
        steer = round(self._turn_controller.step(route_np, ego_speed, ego_position, compass), 3)
        control = carla.VehicleControl()
        control.steer = steer  # faultline: no steer noise
        control.throttle = float(throttle)
        control.brake = float(brake or control_brake)
        if control.throttle == 0 and ego_speed < self.config.minimum_speed_to_prevent_rolling_back:
            control.brake = 1
        return control

    def _compute_target_speed_idm(self, desired_speed, leading_actor_length, ego_speed, leading_actor_speed,
                                  distance_to_leading_actor, s0=4., T=0.5):
        c = self.config
        a = c.idm_maximum_acceleration
        b = c.idm_comfortable_braking_deceleration_high_speed if ego_speed > \
            c.idm_comfortable_braking_deceleration_threshold else c.idm_comfortable_braking_deceleration_low_speed
        delta = c.idm_acceleration_exponent
        # faultline: scipy RK45 over t_bound = 0.05 s replaced by one explicit Euler step of the same equations
        speed_diff = ego_speed - leading_actor_speed
        s_star = s0 + ego_speed * T + ego_speed * speed_diff / 2. / np.sqrt(a * b)
        s = max(0.1, distance_to_leading_actor - leading_actor_length)
        dvdt = a * (1. - (ego_speed / desired_speed)**delta - (s_star / s)**2)
        return float(np.clip(ego_speed + c.idm_t_bound * dvdt, 0, np.inf))

    def predict_other_actors_bounding_boxes(self, actor_list, ego_vehicle_location, num_future_frames,
                                            near_lane_change):
        c = self.config
        predicted_bounding_boxes = {}
        nearby_actors = [actor for actor in actor_list if actor.id != self.EGO_ID and
                         actor.get_location().distance(ego_vehicle_location) < c.detection_radius]
        if nearby_actors:
            previous_controls = [actor.get_control() for actor in nearby_actors]
            previous_actions = np.array([[ctl.steer, ctl.throttle, ctl.brake] for ctl in previous_controls])
            velocities = np.array([actor.get_velocity().length() for actor in nearby_actors])
            locations = np.array([[actor.get_location().x, actor.get_location().y, actor.get_location().z]
                                  for actor in nearby_actors])
            headings = np.deg2rad(np.array([actor.get_transform().rotation.yaw for actor in nearby_actors]))
            future_locations = np.empty((num_future_frames, len(nearby_actors), 3), dtype="float")
            future_headings = np.empty((num_future_frames, len(nearby_actors)), dtype="float")
            future_velocities = np.empty((num_future_frames, len(nearby_actors)), dtype="float")
            for i in range(num_future_frames):
                locations, headings, velocities = self.vehicle_model.forecast_other_vehicles(
                    locations, headings, velocities, previous_actions)
                future_locations[i] = locations.copy()
                future_velocities[i] = velocities.copy()
                future_headings[i] = headings.copy()
            future_headings = np.rad2deg(future_headings)
            for actor_idx, actor in enumerate(nearby_actors):
                predicted_actor_boxes = []
                for i in range(num_future_frames):
                    location = carla.Location(x=future_locations[i, actor_idx, 0].item(),
                                              y=future_locations[i, actor_idx, 1].item(),
                                              z=future_locations[i, actor_idx, 2].item())
                    rotation = carla.Rotation(pitch=0, yaw=future_headings[i, actor_idx], roll=0)
                    extent = actor.bounding_box.extent
                    extent = carla.Vector3D(x=extent.x, y=extent.y, z=extent.z)
                    s = c.high_speed_min_extent_x_other_vehicle_lane_change if near_lane_change \
                        else c.high_speed_min_extent_x_other_vehicle
                    extent.x *= c.slow_speed_extent_factor_ego if future_velocities[
                        i, actor_idx] < c.extent_other_vehicles_bbs_speed_threshold else max(
                            s, c.high_speed_min_extent_x_other_vehicle * float(i) / float(num_future_frames))
                    extent.y *= c.slow_speed_extent_factor_ego if future_velocities[
                        i, actor_idx] < c.extent_other_vehicles_bbs_speed_threshold else max(
                            c.high_speed_min_extent_y_other_vehicle,
                            c.high_speed_extent_y_factor_other_vehicle * float(i) / float(num_future_frames))
                    bounding_box = carla.BoundingBox(location, extent)
                    bounding_box.rotation = rotation
                    predicted_actor_boxes.append(bounding_box)
                predicted_bounding_boxes[actor.id] = predicted_actor_boxes
        return predicted_bounding_boxes

    def compute_target_speed_wrt_leading_vehicle(self, initial_target_speed, predicted_bounding_boxes,
                                                 near_lane_change, ego_location, leading_vehicle_ids, ego_speed):
        c = self.config
        target_speed_wrt_leading_vehicle = initial_target_speed
        for vehicle_id, _ in predicted_bounding_boxes.items():
            if vehicle_id in leading_vehicle_ids and not near_lane_change:
                vehicle = self._tracks[vehicle_id]
                other_speed = vehicle.get_velocity().length()
                distance_to_vehicle = ego_location.distance(vehicle.get_location())
                target_speed_wrt_leading_vehicle = min(
                    target_speed_wrt_leading_vehicle,
                    self._compute_target_speed_idm(desired_speed=initial_target_speed,
                                                   leading_actor_length=vehicle.bounding_box.extent.x * 2,
                                                   ego_speed=ego_speed, leading_actor_speed=other_speed,
                                                   distance_to_leading_actor=distance_to_vehicle,
                                                   s0=c.idm_leading_vehicle_minimum_distance,
                                                   T=c.idm_leading_vehicle_time_headway))
        return target_speed_wrt_leading_vehicle

    def compute_target_speeds_wrt_all_actors(self, initial_target_speed, ego_bounding_boxes, predicted_bounding_boxes,
                                             near_lane_change, leading_vehicle_ids, rear_vehicle_ids):
        target_speed_vehicle = initial_target_speed
        for i, ego_bounding_box in enumerate(ego_bounding_boxes):
            for vehicle_id, bounding_boxes in predicted_bounding_boxes.items():
                if vehicle_id in leading_vehicle_ids and not near_lane_change:
                    continue
                elif vehicle_id in rear_vehicle_ids and not near_lane_change:
                    continue
                elif self.check_obb_intersection(ego_bounding_box, bounding_boxes[i]):
                    # faultline: tracks have no base_type, so only the source's non-bicycle branch remains
                    self.vehicle_hazard = True
                    self.vehicle_affecting_id = vehicle_id
                    target_speed_vehicle = 0
        return target_speed_vehicle

    def get_brake_and_target_speed(self, route_points, vehicle_list, ego_vehicle_transform, ego_speed,
                                   initial_target_speed):
        c = self.config
        ego_vehicle_location = ego_vehicle_transform.location
        self.vehicle_hazard = False
        self.vehicle_affecting_id = None
        near_lane_change = False  # faultline: is_near_lane_change is always False on an all-LANEFOLLOW route
        num_future_frames = int(c.bicycle_frame_rate *
                                (c.forecast_length_lane_change if near_lane_change else c.default_forecast_length))
        ego_bounding_boxes = self.forecast_ego_agent(ego_vehicle_transform, ego_speed, num_future_frames,
                                                     initial_target_speed, route_points)
        predicted_bounding_boxes = self.predict_other_actors_bounding_boxes(vehicle_list, ego_vehicle_location,
                                                                            num_future_frames, near_lane_change)
        leading_vehicle_ids = self._waypoint_planner.compute_leading_vehicles(vehicle_list, self.EGO_ID)
        trailing_vehicle_ids = self._waypoint_planner.compute_trailing_vehicles(vehicle_list, self.EGO_ID)
        self.leading_ids = leading_vehicle_ids
        target_speed_leading = self.compute_target_speed_wrt_leading_vehicle(
            initial_target_speed, predicted_bounding_boxes, near_lane_change, ego_vehicle_location,
            leading_vehicle_ids, ego_speed)
        target_speed_vehicle = self.compute_target_speeds_wrt_all_actors(
            initial_target_speed, ego_bounding_boxes, predicted_bounding_boxes, near_lane_change,
            leading_vehicle_ids, trailing_vehicle_ids)
        # faultline: no walkers, red lights or stop signs on the scenario segment
        target_speed = min(target_speed_leading, target_speed_vehicle)
        return target_speed == 0, target_speed

    def forecast_ego_agent(self, current_ego_transform, current_ego_speed, num_future_frames, initial_target_speed,
                           route_points):
        c = self.config
        self._turn_controller.save_state()
        self._waypoint_planner.save()
        location = np.array([current_ego_transform.location.x, current_ego_transform.location.y,
                             current_ego_transform.location.z])
        heading_angle = np.array([np.deg2rad(current_ego_transform.rotation.yaw)])
        speed = np.array([current_ego_speed])
        throttle = self._longitudinal_controller.get_throttle_extrapolation(initial_target_speed, current_ego_speed)
        steering = self._turn_controller.step(route_points, speed, location, heading_angle.item())
        action = np.array([steering, throttle, 0.0]).flatten()
        future_bounding_boxes = []
        for _ in range(num_future_frames):
            location, heading_angle, speed = self.ego_model.forecast_ego_vehicle(location, heading_angle, speed,
                                                                                 action)
            extrapolated_route = self._waypoint_planner.run_step(location)
            steering = self._turn_controller.step(extrapolated_route, speed, location, heading_angle.item())
            throttle = self._longitudinal_controller.get_throttle_extrapolation(initial_target_speed, speed)
            action = np.array([steering, throttle, 0.0]).flatten()
            heading_angle_degrees = np.rad2deg(heading_angle).item()
            extent = self.ego_extent
            extent = carla.Vector3D(x=extent.x, y=extent.y, z=extent.z)
            extent.x *= c.slow_speed_extent_factor_ego if current_ego_speed < \
                c.extent_ego_bbs_speed_threshold else c.high_speed_extent_factor_ego_x
            extent.y *= c.slow_speed_extent_factor_ego if current_ego_speed < \
                c.extent_ego_bbs_speed_threshold else c.high_speed_extent_factor_ego_y
            ego_bounding_box = carla.BoundingBox(carla.Location(x=location[0].item(), y=location[1].item(),
                                                                z=location[2].item()), extent)
            ego_bounding_box.rotation = carla.Rotation(pitch=0, yaw=heading_angle_degrees, roll=0)
            future_bounding_boxes.append(ego_bounding_box)
        self._turn_controller.load_state()
        self._waypoint_planner.load()
        return future_bounding_boxes

    @staticmethod
    def _dot_product(vector1, vector2):
        return vector1.x * vector2.x + vector1.y * vector2.y + vector1.z * vector2.z

    @staticmethod
    def cross_product(vector1, vector2):
        return carla.Vector3D(x=vector1.y * vector2.z - vector1.z * vector2.y,
                              y=vector1.z * vector2.x - vector1.x * vector2.z,
                              z=vector1.x * vector2.y - vector1.y * vector2.x)

    def get_separating_plane(self, relative_position, plane_normal, obb1, obb2):
        projection_distance = abs(self._dot_product(relative_position, plane_normal))
        obb1_projection = (abs(self._dot_product(obb1.rotation.get_forward_vector() * obb1.extent.x, plane_normal)) +
                           abs(self._dot_product(obb1.rotation.get_right_vector() * obb1.extent.y, plane_normal)) +
                           abs(self._dot_product(obb1.rotation.get_up_vector() * obb1.extent.z, plane_normal)))
        obb2_projection = (abs(self._dot_product(obb2.rotation.get_forward_vector() * obb2.extent.x, plane_normal)) +
                           abs(self._dot_product(obb2.rotation.get_right_vector() * obb2.extent.y, plane_normal)) +
                           abs(self._dot_product(obb2.rotation.get_up_vector() * obb2.extent.z, plane_normal)))
        return projection_distance > obb1_projection + obb2_projection

    def check_obb_intersection(self, obb1, obb2):
        relative_position = obb2.location - obb1.location
        axes1 = (obb1.rotation.get_forward_vector(), obb1.rotation.get_right_vector(), obb1.rotation.get_up_vector())
        axes2 = (obb2.rotation.get_forward_vector(), obb2.rotation.get_right_vector(), obb2.rotation.get_up_vector())
        # faultline: the source's 15 explicit calls written as loops (same axes, same order)
        if any(self.get_separating_plane(relative_position, n, obb1, obb2) for n in axes1 + axes2):
            return False
        if any(self.get_separating_plane(relative_position, self.cross_product(u, v), obb1, obb2)
               for u in axes1 for v in axes2):
            return False
        return True
