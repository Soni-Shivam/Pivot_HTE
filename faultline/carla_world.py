"""CARLA 0.10 world: same World interface as KinematicWorld, LiDAR-measured gap on the ego (spec §2.1, plan Task 7).

Town10 is a city grid with 90-degree corners every 100-150 m; at the frozen 20 m/s no physics-driven car holds its
lane through them, and the LiDAR then loses the lead. So longitudinal motion comes from the same deterministic
integrator as KinematicWorld (IDM ego with reaction delay, LeadLongitudinal, friction clamp), and both cars are placed
on the lane centre of one shared route every tick with CARLA physics off. CARLA supplies the 3-D world, the ray-cast
LiDAR the metrics are computed from, the collision sensor and the recorder.
"""
import fcntl
import math
import queue
from dataclasses import replace
from pathlib import Path

import carla
import numpy as np

from faultline.config import IdmParams, Scenario
from faultline.perception import GapTracker, corridor_gap
from faultline.world import EGO_LEN_M, LEAD_LEN_M, KinematicWorld, TickState

# Denser than the plan's 32 ch / 400k / -20..5 deg, which left 4-16 points on the lead at 39 m (corridor often empty).
LIDAR_ATTRS = {"channels": "64", "range": "80", "points_per_second": "1200000", "rotation_frequency": "20",
               "upper_fov": "2", "lower_fov": "-15"}
LIDAR_X, LIDAR_Z = 1.5, 1.9
STRAIGHT_M = 140.0
ROUTE_STEP_M, ROUTE_LEN_M = 2.0, 1000.0
LOCK_PATH = "/tmp/faultline-carla.lock"  # one synchronous-mode client at a time on the shared server


def _yaw_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


class CarlaWorld:
    name = "carla-0.10.0"

    def __init__(self, host="127.0.0.1", port=2000, map_name="Town10HD_Opt", recorder_path: Path | None = None,
                 idm: IdmParams = IdmParams(), view=None):
        self.view = view  # optional faultline.viewer.ChaseView (display only)
        self.client = carla.Client(host, port)
        self.client.set_timeout(120.0)
        self.map_name, self.recorder_path, self.idm_params = map_name, recorder_path, idm
        self.world = self.client.get_world()
        self.actors, self.recording, self.on_tick = [], False, None
        self.tracks, self.last_decision, self.last_scan = [], None, None  # display hooks (viewer / ROS bridge)

    def _candidates(self, m):
        out = []
        for sp in m.get_spawn_points():
            wp = m.get_waypoint(sp.location, project_to_road=True, lane_type=carla.LaneType.Driving)
            cur, d = wp, 0.0
            while d < STRAIGHT_M:
                nxt = cur.next(5.0)
                if not nxt or nxt[0].is_junction:
                    break
                cur, d = nxt[0], d + 5.0
            if d >= STRAIGHT_M:
                out.append(wp)
        return sorted(out, key=lambda w: (w.road_id, w.lane_id, w.transform.location.x, w.transform.location.y))

    def _acquire(self, s) -> None:
        """Exclusive flock on the shared server, then synchronous mode at the scenario's dt (undone in close())."""
        self.s = s
        self._lock = open(LOCK_PATH, "w")
        fcntl.flock(self._lock, fcntl.LOCK_EX)  # blocks while another faultline process drives CARLA
        if self.map_name not in self.world.get_map().name:
            self.world = self.client.load_world(self.map_name)
        st = self.world.get_settings()
        st.synchronous_mode, st.fixed_delta_seconds = True, s.dt_s
        self.world.apply_settings(st)

    def reset(self, s: Scenario) -> None:
        self._acquire(s)
        cands = self._candidates(self.world.get_map())
        route = [cands[s.seed % len(cands)]]
        while len(route) * ROUTE_STEP_M < ROUTE_LEN_M:  # at a junction take the straightest branch
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

        self.kin = KinematicWorld(s, self.idm_params)
        bl = self.world.get_blueprint_library()
        self.ego = self._spawn(bl.find("vehicle.lincoln.mkz"), self.kin.ego_x)
        self.lead = self._spawn(bl.find("vehicle.taxi.ford"), self.kin.lead_x)
        # actor origin arc = kinematic centre arc + this, so the real bumpers sit where the 1-D model puts them
        eb, lb = self.ego.bounding_box, self.lead.bounding_box
        self.off = {self.ego.id: EGO_LEN_M / 2 - eb.extent.x - eb.location.x,
                    self.lead.id: -LEAD_LEN_M / 2 + lb.extent.x - lb.location.x}
        self.front_offset = eb.location.x + eb.extent.x - LIDAR_X

        lbp = bl.find("sensor.lidar.ray_cast")
        for k, v in LIDAR_ATTRS.items():
            lbp.set_attribute(k, v)
        self.lidar = self.world.spawn_actor(lbp, carla.Transform(carla.Location(x=LIDAR_X, z=LIDAR_Z)),
                                            attach_to=self.ego)
        self.scans = queue.Queue()
        self.lidar.listen(self.scans.put)
        self.col = self.world.spawn_actor(bl.find("sensor.other.collision"), carla.Transform(), attach_to=self.ego)
        self.hits = queue.Queue()
        self.col.listen(self.hits.put)
        self.actors += [self.lidar, self.col]
        if self.recorder_path:
            self.client.start_recorder(str(Path(self.recorder_path).resolve()), True)
            self.recording = True
        self.tracker = GapTracker(dt_s=s.dt_s)
        self.collided = False
        self._place(self.ego, self.kin.ego_x)
        self._place(self.lead, self.kin.lead_x)
        self.world.tick()  # settle the spawn; t_s stays 0
        while not self.scans.empty():
            self.scans.get_nowait()
        if self.view:
            self.view.attach(self)

    @property
    def t_s(self) -> float:
        return self.kin.t_s

    def _pose(self, arc: float) -> carla.Transform:
        i = int(np.clip(arc // ROUTE_STEP_M, 0, len(self.pts) - 2))
        f = arc - i * ROUTE_STEP_M
        x, y = self.pts[i] + self.dirs[i] * f
        z = self.zs[i] + (self.zs[i + 1] - self.zs[i]) * f / ROUTE_STEP_M
        yaw = math.degrees(math.atan2(self.dirs[i][1], self.dirs[i][0]))
        return carla.Transform(carla.Location(float(x), float(y), float(z) + 0.05), carla.Rotation(yaw=yaw))

    def _spawn(self, bp, arc):
        t = self._pose(arc)
        t.location.z += 0.5
        a = self.world.spawn_actor(bp, t)
        a.set_simulate_physics(False)
        self.actors.append(a)
        return a

    def _place(self, a, centre_arc):
        a.set_transform(self._pose(centre_arc + self.off[a.id]))

    def _route_coords(self, xy: np.ndarray, i0: int, n: int = 60):
        """(arc length, lateral offset, nearest sample index) of world-frame xy points against route samples i0..i0+n."""
        seg, dirs = self.pts[i0:i0 + n], self.dirs[i0:i0 + n]
        j = ((xy[:, None, :] - seg[None]) ** 2).sum(-1).argmin(1)
        rel, t = xy - seg[j], dirs[j]
        return (i0 + j) * ROUTE_STEP_M + (rel * t).sum(1), rel[:, 0] * t[:, 1] - rel[:, 1] * t[:, 0], j + i0

    def _straighten(self, scan) -> np.ndarray:
        """LiDAR points re-expressed in route coordinates (x = arc length ahead of the sensor, y = lateral offset from
        the lane centre, z = height above the road minus the sensor's height), so the straight corridor filter of
        `corridor_gap` follows the lane through bends and slopes."""
        p = np.frombuffer(scan.raw_data, dtype=np.float32).reshape(-1, 4)
        w = (np.array(scan.transform.get_matrix()) @ np.column_stack([p[:, :3], np.ones(len(p))]).T).T
        loc = scan.transform.location
        i0 = max(int(self.kin.ego_x // ROUTE_STEP_M) - 2, 0)
        s0, _, j0 = self._route_coords(np.array([[loc.x, loc.y]]), i0, 10)
        arc, lat, j = self._route_coords(w[:, :2], i0)
        z = (w[:, 2] - self.zs[j]) - (loc.z - self.zs[j0[0]])
        return np.column_stack([arc - s0[0], lat, z, p[:, 3]]).astype(np.float32)

    def set_lead_decel(self, decel_mps2: float | None) -> None:
        self.kin.set_lead_decel(decel_mps2)  # same friction clamp and MAINTAIN hold as the kinematic world

    def tick(self) -> TickState:
        st = self.kin.tick()
        self._place(self.ego, st.ego_x)
        self._place(self.lead, st.lead_x)
        frame = self.world.tick()
        scan = self.scans.get(timeout=10.0)
        while scan.frame < frame:
            scan = self.scans.get(timeout=10.0)
        self.last_scan = scan
        lidar_gap, closing = self.tracker.update(corridor_gap(self._straighten(scan), self.front_offset))
        while not self.hits.empty():  # any contact counts (lead, wall, prop)
            self.hits.get_nowait()
            self.collided = True
        self.collided = self.collided or st.collision
        out = replace(st, lidar_gap=lidar_gap, lidar_closing=closing, collision=self.collided)
        if self.on_tick:
            self.on_tick(self, out)
        return out

    def close(self) -> None:
        try:
            if self.view:
                self.view.close()
            if self.recording:
                self.client.stop_recorder()
                self.recording = False
            for a in self.actors:
                if a.type_id.startswith("sensor."):
                    a.stop()
            self.client.apply_batch_sync([carla.command.DestroyActor(a.id) for a in self.actors])
            self.actors = []
        finally:
            st = self.world.get_settings()
            st.synchronous_mode, st.fixed_delta_seconds = False, None
            self.world.apply_settings(st)
            if getattr(self, "_lock", None):
                self._lock.close()  # releases the flock
                self._lock = None
