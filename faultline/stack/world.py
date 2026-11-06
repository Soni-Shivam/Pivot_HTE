"""CARLA cut-in world driven by any AVStack on any validated site (subclass; carla_cutin.py stays untouched).

Faultline owns the world, the adversary, the clock and the ground truth; the stack gets its declared sensors, its
own EgoState and the mission. The parent's tick calls `self.pdm.run_step(...)` for the ego control; here `self.pdm`
is a shim that asks the stack instead, so every tick, metric and log path is the parent's.
"""
import math
import queue
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import carla
import numpy as np

from faultline.carla_cutin import SETTLE_TICKS, CutInCarlaWorld
from faultline.carla_world import LIDAR_ATTRS, LIDAR_X, LIDAR_Z, ROUTE_STEP_M, _yaw_diff
from faultline.cutin import CutInAdversary, CutInScenario
from faultline.ego.lidar_tracker import LidarTracker
from faultline.perception import GapTracker
from faultline.rosbridge import MAP_OSM
from faultline.stack.interface import SENSOR_BLUEPRINTS, Control, EgoState
from faultline.stack.mission import Mission

ROUTE_LEN_M = 300.0


@dataclass(frozen=True)
class StackCutInScenario(CutInScenario):
    """CutInScenario + where and against what: both go into the scenario hash."""
    site_id: str = ""
    stack_name: str = ""
    stack_digest: str = ""
    goal_m: float = 70.0


class _Shim:
    def __init__(self, w):
        self.w = w
        self.target_speed_out = 0.0

    def run_step(self, tf, v, tracks):  # the parent's call; tracks (Faultline's own, display only) are not passed on
        return self.w.stack_control()


class SimClockRecorder:
    """Chase camera, one frame per simulation tick piped to ffmpeg (so two runs line up exactly in sim time), plus an
    .srt HUD line per tick. No display needed."""

    def __init__(self, out_dir: Path, label: str, w: int = 960, h: int = 540):
        self.out, self.label, self.W, self.H, self.cues = Path(out_dir), label, w, h, []

    def attach(self, world) -> None:
        bp = world.world.get_blueprint_library().find("sensor.camera.rgb")
        for k, v in {"image_size_x": str(self.W), "image_size_y": str(self.H), "fov": "90"}.items():
            bp.set_attribute(k, v)
        self.cam = world.world.spawn_actor(bp, carla.Transform(carla.Location(x=-7.0, z=3.0), carla.Rotation(pitch=-10)),
                                           attach_to=world.ego)
        world.actors.append(self.cam)
        self.frames = queue.Queue()
        self.cam.listen(self.frames.put)
        self.ff = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgra", "-s",
                                    f"{self.W}x{self.H}", "-r", "20", "-i", "-", "-c:v", "libx264", "-preset", "veryfast",
                                    "-pix_fmt", "yuv420p", str(self.out / "chase_raw.mp4")], stdin=subprocess.PIPE)
        prev = world.on_tick
        world.on_tick = lambda w, s: (prev and prev(w, s), self.on_tick(w, s))

    def on_tick(self, world, st) -> None:
        f = world.last_scan.frame
        img = self.frames.get(timeout=10.0)
        while img.frame < f:
            img = self.frames.get(timeout=10.0)
        self.ff.stdin.write(bytes(img.raw_data))
        ttc = f"{st.gt_ttc_s:4.1f}" if st.gt_ttc_s is not None else " -- "
        self.cues.append((st.t_s, f"{self.label} | t {st.t_s:5.2f} s | gap {st.gt_gap:6.1f} m | TTC {ttc} s | "
                                  f"ego {st.ego_v:4.1f} m/s | brake {st.ego_brake:.2f} | adversary {world.control_label}"
                                  + (" | COLLISION" if st.collision else "")))

    def close(self) -> None:
        if getattr(self, "ff", None):
            self.ff.stdin.close()
            self.ff.wait()
            self.ff = None
        ts = lambda t: f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d},{int(round(t % 1 * 1000)) % 1000:03d}"
        with open(self.out / "hud.srt", "w") as f:
            for i, (t, text) in enumerate(self.cues):
                f.write(f"{i + 1}\n{ts(t - 0.05)} --> {ts(t)}\n{text}\n\n")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(self.out / "chase_raw.mp4"), "-vf",
                        f"subtitles={self.out / 'hud.srt'}:force_style='FontSize=11,Alignment=7'", "-c:v", "libx264",
                        "-preset", "veryfast", "-pix_fmt", "yuv420p", str(self.out / "screen.mp4")], check=False)


def sensor_data(kind: str, m):
    if kind == "lidar":
        return np.frombuffer(m.raw_data, dtype=np.float32).reshape(-1, 4).copy()
    if kind == "camera":
        return np.frombuffer(m.raw_data, dtype=np.uint8).reshape(m.height, m.width, 4).copy()
    if kind == "gnss":
        return np.array([m.latitude, m.longitude, m.altitude])
    if kind == "imu":
        a, g = m.accelerometer, m.gyroscope
        return np.array([a.x, a.y, a.z, g.x, g.y, g.z, m.compass])
    raise ValueError(kind)


class StackCutInWorld(CutInCarlaWorld):
    name = "carla-0.10.0-cut-in-stack"

    def __init__(self, stack, site: dict, *a, recorder: SimClockRecorder | None = None, **kw):
        super().__init__(*a, **kw)
        self.stack, self.site, self.recorder = stack, site, recorder
        self.ego_name = getattr(stack, "name", type(stack).__name__)
        self.latencies, self.invalid_controls, self.mission = [], [], None

    def _route_from(self, wp):
        route = [wp]
        while len(route) * ROUTE_STEP_M < ROUTE_LEN_M:  # at a junction take the straightest branch
            nxt = route[-1].next(ROUTE_STEP_M)
            if not nxt:
                break
            route.append(min(nxt, key=lambda q: _yaw_diff(q.transform.rotation.yaw, route[-1].transform.rotation.yaw)))
        return route

    def reset(self, s: CutInScenario) -> None:
        try:
            self._reset(s)
        except BaseException:
            self.close()  # run_episode calls reset outside its try: never leave sync mode or actors behind
            raise

    def _reset(self, s: CutInScenario) -> None:
        assert s.cut_in_side == "left", "sites put the adversary in the same-direction lane on the ego's left"
        site = self.site
        self._acquire(s)
        m = self.world.get_map()
        wp = m.get_waypoint(carla.Location(*site["start_xyz"]), project_to_road=True, lane_type=carla.LaneType.Driving)
        assert (wp.road_id, wp.lane_id) == (site["road"], site["lane"]), ("map changed", wp.road_id, wp.lane_id)
        left = wp.get_left_lane()
        assert left and left.lane_id == site["left_lane"] and abs(wp.lane_width - s.lane_width_m) < 0.05, "map changed"
        self.route = self._route_from(wp)
        self.pts = np.array([[w.transform.location.x, w.transform.location.y] for w in self.route])
        self.zs = np.array([w.transform.location.z for w in self.route])
        d = np.diff(self.pts, axis=0)
        d = np.vstack([d, d[-1:]])
        self.dirs = d / np.linalg.norm(d, axis=1, keepdims=True)

        bl = self.world.get_blueprint_library()
        t = self._pose(0.0)
        t.location.z += 0.3
        self.ego = self.world.spawn_actor(bl.find("vehicle.lincoln.mkz"), t)
        self.actors.append(self.ego)
        eb = self.ego.bounding_box
        self.ego_len, self.ego_wid = 2 * eb.extent.x, 2 * eb.extent.y
        self.adv = None
        self.lead = self.world.spawn_actor(bl.find("vehicle.taxi.ford"), self._lateral(self._pose(30.0), s.lane_width_m))
        self.lead.set_simulate_physics(False)
        self.actors.append(self.lead)
        lb = self.lead.bounding_box
        self.adv_len, self.adv_wid, self.adv_off = 2 * lb.extent.x, 2 * lb.extent.y, -lb.location.x
        self.front_offset = eb.location.x + eb.extent.x - LIDAR_X

        # Faultline's own LiDAR: ground-side gap metrics and display tracks, never given to the stack
        lbp = bl.find("sensor.lidar.ray_cast")
        for k, v in LIDAR_ATTRS.items():
            lbp.set_attribute(k, v)
        self.lidar = self.world.spawn_actor(lbp, carla.Transform(carla.Location(x=LIDAR_X, z=LIDAR_Z)), attach_to=self.ego)
        self.scans = queue.Queue()
        self.lidar.listen(self.scans.put)
        self.col = self.world.spawn_actor(bl.find("sensor.other.collision"), carla.Transform(), attach_to=self.ego)
        self.hits = queue.Queue()
        self.col.listen(self.hits.put)
        self.actors += [self.lidar, self.col]
        self.stack_sensors = []  # (spec, actor or None, queue, every_tick)
        for spec in self.stack.sensors():
            bpn = SENSOR_BLUEPRINTS[spec.type]
            if bpn is None:
                self.stack_sensors.append((spec, None, None, True))
                continue
            bp = bl.find(bpn)
            for k, v in spec.params.items():
                bp.set_attribute(k, str(v))
            every = spec.rate_hz >= 1 / s.dt_s - 1e-6
            if bp.has_attribute("sensor_tick"):
                bp.set_attribute("sensor_tick", "0.0" if every else str(1 / spec.rate_hz))
            a = self.world.spawn_actor(bp, carla.Transform(carla.Location(spec.x, spec.y, spec.z),
                                                           carla.Rotation(pitch=spec.pitch, yaw=spec.yaw, roll=spec.roll)),
                                       attach_to=self.ego)
            q = queue.Queue()
            a.listen(q.put)
            self.actors.append(a)
            self.stack_sensors.append((spec, a, q, every))
        self._latest = {}

        for _ in range(SETTLE_TICKS):
            self.ego.apply_control(carla.VehicleControl(brake=1.0))
            self.world.tick()
        ego_arc, ego_lat = self._ego_sl()
        self.adv = CutInAdversary(s, arc=ego_arc + self.ego_len / 2 + s.initial_gap_m + self.adv_len / 2,
                                  v=s.lead_speed_mps, lat=s.lane_width_m)
        self._place_adv()
        yaw = math.radians(self.ego.get_transform().rotation.yaw)
        self.ego.set_target_velocity(carla.Vector3D(x=s.ego_speed_mps * math.cos(yaw),
                                                    y=s.ego_speed_mps * math.sin(yaw), z=0.0))
        w2 = s.lane_width_m / 2
        self.mission = Mission(
            site_id=site["id"], start_xyz=tuple(site["start_xyz"]), start_yaw_deg=site["yaw_deg"],
            route_xyz=tuple((float(x), float(y), float(z)) for (x, y), z in zip(self.pts, self.zs)),
            goal_m=getattr(s, "goal_m", 70.0), time_limit_s=s.horizon_s, target_speed_mps=s.ego_speed_mps,
            lane_width_m=s.lane_width_m, lat_bounds_m=(-w2, 3 * w2), dt_s=s.dt_s,
            route_gps=tuple((g.latitude, g.longitude, g.altitude) for g in
                            (m.transform_to_geolocation(w.transform.location) for w in self.route)))
        self.stack.setup(self.mission, str(MAP_OSM))
        pc = self.ego.get_physics_control()
        self._ego_static = dict(length_m=self.ego_len, width_m=self.ego_wid, height_m=2 * eb.extent.z,
                                bb_offset_x=eb.location.x, max_steer_deg=pc.wheels[0].max_steer_angle,
                                wheelbase_m=abs(pc.wheels[0].location.x - pc.wheels[2].location.x) / 100.0)  # cm -> m
        self.pdm = _Shim(self)
        self.tracker = LidarTracker(s.dt_s, l_min=-w2 + 0.15, l_max=3 * w2 + 0.3, to_world=self._to_world)
        self.gap_tracker = GapTracker(dt_s=s.dt_s)
        if self.recorder_path:
            self.client.start_recorder(str(Path(self.recorder_path).resolve()), True)
            self.recording = True
        self._frame = self.world.tick()
        while not self.scans.empty():
            self.scans.get_nowait()
        while not self.hits.empty():
            self.hits.get_nowait()
        self.collided, self._t, self.prev_v = False, 0.0, self.ego.get_velocity().length()
        self.tracks, self.control = [], carla.VehicleControl()
        if self.view:
            self.view.attach(self)
        if self.recorder:
            self.recorder.attach(self)

    def _collect(self, frame: int) -> dict:
        obs = {}
        for spec, actor, q, every in self.stack_sensors:
            if actor is None:
                obs[spec.id] = (frame, {"speed": self.ego.get_velocity().length()})
                continue
            last = self._latest.get(spec.id)
            while True:
                try:
                    item = q.get(timeout=10.0) if every and (last is None or last.frame < frame) else q.get_nowait()
                except queue.Empty:
                    break
                if item.frame <= frame:
                    last = item
            if last is not None:
                self._latest[spec.id] = last
                obs[spec.id] = (last.frame, sensor_data(spec.type, last))
        return obs

    def ego_state(self) -> EgoState:
        tf, v = self.ego.get_transform(), self.ego.get_velocity().length()
        return EgoState(x=tf.location.x, y=tf.location.y, z=tf.location.z, yaw_deg=tf.rotation.yaw, speed_mps=v,
                        accel_mps2=(v - self.prev_v) / self.s.dt_s, pitch_deg=tf.rotation.pitch,
                        roll_deg=tf.rotation.roll, **self._ego_static)

    def stack_control(self) -> carla.VehicleControl:
        frame = self.last_scan.frame if self.last_scan is not None else self._frame
        obs, e = self._collect(frame), self.ego_state()
        t0 = time.perf_counter()
        c = self.stack.run_step(obs, e, self._t)
        self.latencies.append(time.perf_counter() - t0)
        bad = c.problems() if isinstance(c, Control) else [f"not a Control: {type(c).__name__}"]
        if bad:  # never pass an out-of-range command to the vehicle; brake and count it against the stack
            self.invalid_controls.append({"t_s": self._t, "problems": bad})
            c = Control(brake=1.0)
        return carla.VehicleControl(throttle=c.throttle, brake=c.brake, steer=c.steer)

    def close(self) -> None:
        try:
            self.stack.destroy()
        finally:
            super().close()
            if self.recorder:
                self.recorder.close()
