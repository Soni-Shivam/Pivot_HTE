"""CARLA 0.10 world for the cut-in family: PDM-Lite ego on CARLA physics, driven from its own LiDAR only.

Town10HD_Opt road 7 (lanes -2 right, -1 left, 3.5 m, heading ~0.6 deg) continues straight through roads 17 and 10 for
~90 m from x = -28, then curves left. The ego starts in the right lane under PDM-Lite (throttle/steer/brake on the
real vehicle); its proprioception (own pose and speed) comes from CARLA, every other vehicle only from LiDAR tracks.
The adversary starts in the left lane and is kinematic (physics off): placed every tick on the ego lane centre line
shifted laterally by its offset, yawed along its lateral motion, so the LiDAR sees a consistently oriented car.
Ground truth (actor poses) feeds only the gt_* columns and the outcome metrics, never the ego.
"""
import math
import queue
from pathlib import Path

import carla
import numpy as np

from faultline.carla_world import LIDAR_ATTRS, LIDAR_X, LIDAR_Z, ROUTE_STEP_M, CarlaWorld, _yaw_diff
from faultline.cutin import CutInAdversary, CutInScenario, CutInTickState, check_environment, gt_fields
from faultline.ego.lidar_tracker import LidarTracker
from faultline.ego.pdm_lite import PDMLite
from faultline.perception import GapTracker, corridor_gap

EGO_START = carla.Location(x=-24.0, y=-57.75, z=0.0)  # road 7, lane -2 (right), 4 m past the junction edge
EGO_ROAD, EGO_LANE, ROUTE_LEN_M, SETTLE_TICKS = 7, -2, 300.0, 10


class CutInCarlaWorld(CarlaWorld):
    name = "carla-0.10.0-cut-in"
    ego_name = "pdm-lite-lidar"

    def __init__(self, *a, degrade=None, **kw):
        super().__init__(*a, **kw)
        self.degrade = degrade  # optional fn(points N x 4, sensor frame) -> points: the occlusion experiment

    def reset(self, s: CutInScenario) -> None:
        assert s.cut_in_side == "left", "the road 7 layout puts the adversary in the left lane"
        assert check_environment(s) is None, check_environment(s)
        self._acquire(s)
        self._weather0 = None
        if s.env_params:  # shared server: the original weather is put back in close()
            self._weather0 = self.world.get_weather()
            w = self.world.get_weather()
            for k, v in s.env_params["weather"].items():
                setattr(w, k, v)
            self.world.set_weather(w)
        m = self.world.get_map()
        wp = m.get_waypoint(EGO_START, project_to_road=True, lane_type=carla.LaneType.Driving)
        assert (wp.road_id, wp.lane_id) == (EGO_ROAD, EGO_LANE), (wp.road_id, wp.lane_id)
        left = wp.get_left_lane()
        assert left and left.lane_id == -1 and abs(wp.lane_width - s.lane_width_m) < 0.05, "map changed"
        route = [wp]
        while len(route) * ROUTE_STEP_M < ROUTE_LEN_M:
            nxt = route[-1].next(ROUTE_STEP_M)
            if not nxt:
                break
            route.append(min(nxt, key=lambda q: _yaw_diff(q.transform.rotation.yaw, route[-1].transform.rotation.yaw)))
        self.route = route
        self.pts = np.array([[w.transform.location.x, w.transform.location.y] for w in route])
        self.zs = np.array([w.transform.location.z for w in route])
        d = np.diff(self.pts, axis=0)
        d = np.vstack([d, d[-1:]])
        self.dirs = d / np.linalg.norm(d, axis=1, keepdims=True)

        bl = self.world.get_blueprint_library()
        t = self._pose(0.0)
        t.location.z += 0.3
        self.ego = self.world.spawn_actor(bl.find("vehicle.lincoln.mkz"), t)
        self.actors.append(self.ego)
        if s.env_params:  # road friction: the ego's tyres (CARLA physics); the adversary's brake clamp uses s.friction_mu
            pc = self.ego.get_physics_control()
            for wh in pc.wheels:
                wh.friction_force_multiplier = s.friction_mu / 0.8
            self.ego.apply_physics_control(pc)
        eb = self.ego.bounding_box
        self.ego_len, self.ego_wid = 2 * eb.extent.x, 2 * eb.extent.y
        self.adv = None
        self.lead = self.world.spawn_actor(bl.find("vehicle.taxi.ford"), self._lateral(self._pose(30.0), s.lane_width_m))
        self.lead.set_simulate_physics(False)
        self.actors.append(self.lead)
        lb = self.lead.bounding_box
        self.adv_len, self.adv_wid, self.adv_off = 2 * lb.extent.x, 2 * lb.extent.y, -lb.location.x
        self.front_offset = eb.location.x + eb.extent.x - LIDAR_X

        lbp = bl.find("sensor.lidar.ray_cast")
        for k, v in LIDAR_ATTRS.items():
            lbp.set_attribute(k, v)
        for k, v in (s.env_params or {}).get("lidar", {}).items():
            lbp.set_attribute(k, str(v))
        if s.env_params:
            lbp.set_attribute("noise_seed", str(s.seed))
        self.lidar = self.world.spawn_actor(lbp, carla.Transform(carla.Location(x=LIDAR_X, z=LIDAR_Z)),
                                            attach_to=self.ego)
        self.scans = queue.Queue()
        self.lidar.listen(self.scans.put)
        self.col = self.world.spawn_actor(bl.find("sensor.other.collision"), carla.Transform(), attach_to=self.ego)
        self.hits = queue.Queue()
        self.col.listen(self.hits.put)
        self.actors += [self.lidar, self.col]
        for _ in range(SETTLE_TICKS):  # let the physics ego drop onto the road; t_s stays 0
            self.ego.apply_control(carla.VehicleControl(brake=1.0))
            self.world.tick()
        ego_arc, ego_lat = self._ego_sl()
        self.adv = CutInAdversary(s, arc=ego_arc + self.ego_len / 2 + s.initial_gap_m + self.adv_len / 2,
                                  v=s.lead_speed_mps, lat=s.lane_width_m)
        self._place_adv()
        yaw = math.radians(self.ego.get_transform().rotation.yaw)
        self.ego.set_target_velocity(carla.Vector3D(x=s.ego_speed_mps * math.cos(yaw),
                                                    y=s.ego_speed_mps * math.sin(yaw), z=0.0))
        self.pdm = PDMLite(np.column_stack([self.pts, self.zs]), eb, s.ego_speed_mps)
        # ROI = the ego lane (minus its outer 0.15 m: roadside poles/fence reach the kerb line on road 7) and the
        # adjacent same-direction lane with 0.3 m margin: no sidewalk clutter, no oncoming lanes
        w2 = s.lane_width_m / 2
        self.tracker = LidarTracker(s.dt_s, l_min=-w2 + 0.15, l_max=3 * w2 + 0.3, to_world=self._to_world)
        self.gap_tracker = GapTracker(dt_s=s.dt_s)
        if self.recorder_path:
            self.client.start_recorder(str(Path(self.recorder_path).resolve()), True)
            self.recording = True
        self.world.tick()
        while not self.scans.empty():
            self.scans.get_nowait()
        while not self.hits.empty():
            self.hits.get_nowait()
        self.collided, self._t, self.prev_v = False, 0.0, self.ego.get_velocity().length()
        self.tracks, self.control = [], carla.VehicleControl()
        if self.view:
            self.view.attach(self)

    def close(self) -> None:
        try:
            if getattr(self, "_weather0", None) is not None:
                self.world.set_weather(self._weather0)
                self.world.tick()  # sync mode: apply it before close() switches back to async
                self._weather0 = None
        finally:
            super().close()

    @property
    def t_s(self) -> float:
        return self._t

    @property
    def control_label(self) -> str:
        return self.adv.mode if self.adv else "-"

    def _lateral(self, t: carla.Transform, lat: float, rel_yaw_deg: float = 0.0) -> carla.Transform:
        """Shift a route pose `lat` m to the left (CARLA is left-handed: left of heading (dx, dy) is (dy, -dx))."""
        r = math.radians(t.rotation.yaw)
        t.location.x += lat * math.sin(r)
        t.location.y -= lat * math.cos(r)
        t.rotation.yaw += rel_yaw_deg  # moving towards the ego lane (rightwards) = clockwise = +yaw
        return t

    def _to_world(self, s_arc: float, lat: float):
        t = self._lateral(self._pose(s_arc), lat)
        i = int(np.clip(s_arc // ROUTE_STEP_M, 0, len(self.pts) - 2))
        return t.location.x, t.location.y, t.location.z, math.degrees(math.atan2(self.dirs[i][1], self.dirs[i][0]))

    def _place_adv(self) -> None:
        a = self.adv
        t = self._lateral(self._pose(a.arc + self.adv_off), a.lat, a.rel_yaw_deg)
        self.client.apply_batch_sync([carla.command.ApplyTransform(self.lead.id, t)], False)

    def _sl(self, xy: np.ndarray, hint_arc: float):
        i0 = max(int(hint_arc // ROUTE_STEP_M) - 12, 0)
        return self._route_coords(xy, i0, 50)

    def _ego_sl(self):
        tf = self.ego.get_transform()
        c = tf.transform(self.ego.bounding_box.location)
        arc, lat, _ = self._sl(np.array([[c.x, c.y]]), getattr(self, "_ego_arc", 0.0))
        self._ego_arc = float(arc[0])
        return float(arc[0]), float(lat[0])

    def _slh(self, scan):
        """Points as (arc, lateral-left, height above the road) and the sensor's own (arc, lateral, height)."""
        p = np.frombuffer(scan.raw_data, dtype=np.float32).reshape(-1, 4)
        if self.degrade is not None:
            p = self.degrade(p)
        w = (np.array(scan.transform.get_matrix()) @ np.column_stack([p[:, :3], np.ones(len(p))]).T).T
        loc = scan.transform.location
        s0, l0, j0 = self._sl(np.array([[loc.x, loc.y]]), self._ego_arc)
        arc, lat, j = self._sl(w[:, :2], self._ego_arc)
        return np.column_stack([arc, lat, w[:, 2] - self.zs[j]]), (float(s0[0]), float(l0[0]),
                                                                  loc.z - self.zs[j0[0]])

    def command_adversary(self, action: str | None) -> dict:
        return self.adv.command(action)

    def tick(self) -> CutInTickState:
        dt = self.s.dt_s
        tf, v = self.ego.get_transform(), self.ego.get_velocity().length()
        self.control = self.pdm.run_step(tf, v, self.tracks)  # proprioception + LiDAR tracks only
        self.ego.apply_control(self.control)
        v_adv0 = self.adv.v
        self.adv.step(dt)
        self._place_adv()
        frame = self.world.tick()
        self._t = round(self._t + dt, 6)
        scan = self.scans.get(timeout=10.0)
        while scan.frame < frame:
            scan = self.scans.get(timeout=10.0)
        self.last_scan = scan
        ego_arc, ego_lat = self._ego_sl()
        slh, (ss, sl, sh) = self._slh(scan)
        self.tracks = self.tracker.update(slh, (ss, sl), (ego_arc, ego_lat), z_world=self.ego.get_location().z)
        rel = np.column_stack([slh[:, 0] - ss, slh[:, 1], slh[:, 2] - sh])
        lidar_gap, closing = self.gap_tracker.update(corridor_gap(rel, self.front_offset))
        ego_v = self.ego.get_velocity().length()
        ego_a, self.prev_v = (ego_v - self.prev_v) / dt, ego_v
        a = self.adv
        gap, in_path, ttc, overlap = gt_fields(ego_arc, ego_lat, ego_v, a.arc, a.lat, a.v, self.ego_len,
                                               self.ego_wid, self.adv_len, self.adv_wid)
        while not self.hits.empty():  # any contact counts (adversary, wall, prop)
            self.hits.get_nowait()
            self.collided = True
        self.collided = self.collided or overlap
        c = self.control
        out = CutInTickState(self._t, ego_arc, ego_v, ego_a, a.arc, a.v, (a.v - v_adv0) / dt, gap, lidar_gap, closing,
                             self.collided, a.lat, ego_lat, in_path, ttc, len(self.tracks), float(c.steer),
                             float(c.throttle), float(c.brake))
        if self.on_tick:
            self.on_tick(self, out)
        return out
