"""Reference stacks implementing AVStack in-process: what a stack owner's Python stack looks like.

PdmLiteStack: our PDM-Lite planner (faultline/ego/pdm_lite.py, from carla_garage, MIT) on our LiDAR tracker, fed
only by its declared LiDAR and its own pose/speed. Same perception and planning as the built-in CutInCarlaWorld ego,
but it reconstructs everything from the observation dict + EgoState + mission route, like an external stack must.
IdmLidarStack: a genuinely different decision layer on the same perception: IDM car-following (1.6 s headway) over
the in-lane LiDAR tracks sets the target speed; PDM-Lite's PID controllers only track it. Used as stack B in the arena.
"""
import math

import carla
import numpy as np

from faultline.carla_world import LIDAR_ATTRS, LIDAR_X, LIDAR_Z
from faultline.config import IdmParams
from faultline.controller import IdmFollower
from faultline.ego.lidar_tracker import LidarTracker
from faultline.ego.pdm_lite import PDMLite
from faultline.stack.interface import Control, EgoState, SensorSpec

ROUTE_STEP_M = 2.0


class RouteFrame:
    """Arc length / lateral-left offset against the mission route polyline (the same maths as CarlaWorld's)."""

    def __init__(self, route_xyz):
        r = np.asarray(route_xyz, dtype=float)
        self.pts, self.zs = r[:, :2], r[:, 2]
        d = np.diff(self.pts, axis=0)
        d = np.vstack([d, d[-1:]])
        self.dirs = d / np.linalg.norm(d, axis=1, keepdims=True)
        self.step = float(np.median(np.linalg.norm(np.diff(self.pts, axis=0), axis=1))) if len(r) > 1 else ROUTE_STEP_M

    def sl(self, xy: np.ndarray, hint_arc: float, back: int = 12, n: int = 50):
        i0 = max(int(hint_arc // self.step) - back, 0)
        seg, dirs = self.pts[i0:i0 + n], self.dirs[i0:i0 + n]
        j = ((xy[:, None, :] - seg[None]) ** 2).sum(-1).argmin(1)
        rel, t = xy - seg[j], dirs[j]
        return (i0 + j) * self.step + (rel * t).sum(1), rel[:, 0] * t[:, 1] - rel[:, 1] * t[:, 0], j + i0

    def to_world(self, s_arc: float, lat: float):
        i = int(np.clip(s_arc // self.step, 0, len(self.pts) - 2))
        x, y = self.pts[i] + self.dirs[i] * (s_arc - i * self.step)
        yaw = math.atan2(self.dirs[i][1], self.dirs[i][0])
        return float(x + lat * math.sin(yaw)), float(y - lat * math.cos(yaw)), float(self.zs[i]), math.degrees(yaw)


def ego_matrix(e: EgoState) -> np.ndarray:
    return np.array(carla.Transform(carla.Location(e.x, e.y, e.z),
                                    carla.Rotation(pitch=e.pitch_deg, yaw=e.yaw_deg, roll=e.roll_deg)).get_matrix())


class PdmLiteStack:
    name = "pdm-lite-lidar"
    files = ("faultline/ego/pdm_lite.py", "faultline/ego/lidar_tracker.py", "faultline/stack/reference.py")

    def sensors(self) -> list[SensorSpec]:
        return [SensorSpec("LIDAR", "lidar", x=LIDAR_X, z=LIDAR_Z, rate_hz=20.0, params=dict(LIDAR_ATTRS)),
                SensorSpec("SPEED", "odometry")]

    def setup(self, mission, hd_map_path: str) -> None:
        self.m, self.frame = mission, RouteFrame(mission.route_xyz)
        w2 = mission.lane_width_m / 2
        # ROI: own lane minus kerb clutter and the adjacent same-direction (left) lane, as the built-in ego
        self.tracker = LidarTracker(mission.dt_s, l_min=-w2 + 0.15, l_max=3 * w2 + 0.3, to_world=self.frame.to_world)
        self.mount = np.array(carla.Transform(carla.Location(x=LIDAR_X, z=LIDAR_Z)).get_matrix())
        self.pdm, self.arc, self.tracks = None, 0.0, []

    def perceive(self, obs: dict, e: EgoState):
        if self.pdm is None:  # needs the ego dimensions, which arrive with the first EgoState
            bb = carla.BoundingBox(carla.Location(x=e.bb_offset_x),
                                   carla.Vector3D(x=e.length_m / 2, y=e.width_m / 2, z=e.height_m / 2))
            self.pdm = PDMLite(np.column_stack([self.frame.pts, self.frame.zs]), bb, self.m.target_speed_mps)
        yaw = math.radians(e.yaw_deg)
        c = np.array([[e.x + e.bb_offset_x * math.cos(yaw), e.y + e.bb_offset_x * math.sin(yaw)]])
        s, l, _ = self.frame.sl(c, self.arc)
        self.arc, self.lat = float(s[0]), float(l[0])
        if "LIDAR" in obs:
            p = np.asarray(obs["LIDAR"][1], dtype=np.float64).reshape(-1, 4)
            ms = ego_matrix(e) @ self.mount
            w = (ms @ np.column_stack([p[:, :3], np.ones(len(p))]).T).T
            s0, l0, j0 = self.frame.sl(ms[None, :2, 3], self.arc)
            arc, lat, j = self.frame.sl(w[:, :2], self.arc)
            slh = np.column_stack([arc, lat, w[:, 2] - self.frame.zs[j]])
            self.tracks = self.tracker.update(slh, (float(s0[0]), float(l0[0])), (self.arc, self.lat), z_world=e.z)
        return carla.Transform(carla.Location(e.x, e.y, e.z), carla.Rotation(yaw=e.yaw_deg))

    def run_step(self, observations: dict, ego_state: EgoState, t_s: float) -> Control:
        tf = self.perceive(observations, ego_state)
        c = self.pdm.run_step(tf, ego_state.speed_mps, self.tracks)
        return Control(float(c.throttle), float(c.brake), float(c.steer))

    def destroy(self) -> None:
        self.pdm = None


class IdmLidarStack(PdmLiteStack):
    name = "idm-1.6s-lidar"
    files = PdmLiteStack.files[:2] + ("faultline/controller.py", "faultline/stack/reference.py")
    HEADWAY_S, MIN_GAP_M, LOOKAHEAD_S = 1.6, 3.0, 1.0

    def setup(self, mission, hd_map_path: str) -> None:
        super().setup(mission, hd_map_path)
        self.idm = IdmFollower(IdmParams(desired_speed_mps=mission.target_speed_mps, time_headway_s=self.HEADWAY_S,
                                         min_gap_m=self.MIN_GAP_M, max_accel_mps2=1.5, comfort_decel_mps2=3.0,
                                         reaction_delay_s=0.0), mission.dt_s)

    def run_step(self, observations: dict, ego_state: EgoState, t_s: float) -> Control:
        tf = self.perceive(observations, ego_state)
        v, half_w = ego_state.speed_mps, ego_state.width_m / 2
        ahead = [t for t in self.tracks if abs(t.l - self.lat) < half_w + t.width / 2 and t.s > self.arc]
        lead = min(ahead, key=lambda t: t.s, default=None)
        gap = (lead.s - lead.length / 2) - (self.arc + ego_state.length_m / 2) if lead else 1e3
        a = self.idm.accel(v, gap, lead.vs if lead else v)
        target = max(0.0, v + a * self.LOOKAHEAD_S)
        p = self.pdm
        pos = np.array([ego_state.x, ego_state.y, ego_state.z])
        if not p.localized:
            p._waypoint_planner.localize(pos)
            p.localized = True
        route_np = p._waypoint_planner.run_step(pos)
        throttle, brake = p._longitudinal_controller.get_throttle_and_brake(a < -3.0, target, v)
        if throttle < 1.0:
            throttle *= p.config.throttle_scale
        steer = round(p._turn_controller.step(route_np, v, pos, math.radians(ego_state.yaw_deg)), 3)
        brake = float(brake) if brake else (1.0 if throttle == 0 and v < p.config.minimum_speed_to_prevent_rolling_back else 0.0)
        return Control(float(throttle), brake, float(steer))
