"""Optional ROS 2 (Jazzy) bridge for a CARLA run: display only, reads the world every tick and never feeds back.

Frames: CARLA is left-handed (y right); ROS is right-handed. Everything published uses the `map` frame with
x_map = x_carla, y_map = -y_carla, z_map = z_carla, yaw_map = -yaw_carla. The LiDAR cloud is in frame `lidar`
(sensor y flipped the same way). Needs `source /opt/ros/jazzy/setup.bash`; rclpy is imported only in attach().
"""
import array
import math
import sys
import threading
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MAP_OSM = ROOT / "maps" / "Town10HD_Opt.osm"
CLOUD_FIELDS = (("x", 0), ("y", 4), ("z", 8), ("intensity", 12))  # float32 each, point_step 16
STALL_S = 0.25  # no tick for this long after the run-up = the loop is waiting for a checkpoint decision
TTC_CLOSING_MIN = 0.05
TTC_LINE_S = 1.5  # HMI reference line on the TTC plot (display only)
HMI_SPEED_CARS = ("ego", "adversary", "A", "B", "C", "D")  # /faultline/hmi/speed/<car>, the HMI layout's series
HMI_EVERY, HMI_MAX = 2, 1200  # HMI history: every 2nd tick (10 Hz), at most 120 s


def to_map(x: float, y: float, z: float = 0.0) -> tuple[float, float, float]:
    return x, -y, z


def yaw_quat(yaw_carla_deg: float) -> tuple[float, float, float, float]:
    """(x, y, z, w) of a pure yaw rotation, CARLA degrees -> right-handed map frame."""
    h = -math.radians(yaw_carla_deg) / 2
    return 0.0, 0.0, math.sin(h), math.cos(h)


def lidar_points(raw: bytes) -> np.ndarray:
    """carla.LidarMeasurement.raw_data (x, y, z, intensity float32, y right) -> (N, 4) float32 with y left."""
    p = np.frombuffer(raw, dtype=np.float32).reshape(-1, 4).copy()
    p[:, 1] *= -1
    return p


def ttc(gap, closing) -> float:
    return gap / closing if gap is not None and closing is not None and closing > TTC_CLOSING_MIN else math.nan


def push_history(h: tuple, row: tuple, cap: int = HMI_MAX) -> tuple:
    """Append one (t, a, b) row to the ([t], [a], [b]) columns, keeping the last `cap`."""
    for col, v in zip(h, row):
        col.append(float(v))
        del col[:-cap]
    return h


def mode_of(decision, t_s: float, runup_s: float, stalled: bool) -> str:
    if decision is not None and (decision.get("source") == "none" or not decision.get("action")):
        return "SAFE_HALT"
    if stalled and t_s >= runup_s - 1e-6:
        return "AWAITING_0G"
    return "RUNUP" if decision is None else "EXECUTING"


def decision_line(d) -> str:
    if d is None:
        return "waiting for the first checkpoint"
    rid = d.get("request_id")
    return (f"cp {d.get('cp')} · {d.get('action') or 'SAFE_HALT'} · {d.get('source')} · "
            f"req {rid[:6] + '…' if rid else '-'} · {d.get('latency_ms')} ms")


def _f(t, k):
    return t[k] if isinstance(t, dict) else getattr(t, k)


def lidar_static_tf():
    from geometry_msgs.msg import TransformStamped
    from tf2_msgs.msg import TFMessage

    from faultline.carla_world import LIDAR_X, LIDAR_Z
    st = TransformStamped()
    st.header.frame_id, st.child_frame_id = "ego", "lidar"
    st.transform.translation.x, st.transform.translation.z = LIDAR_X, LIDAR_Z
    st.transform.rotation.w = 1.0
    return TFMessage(transforms=[st])


def _import_ros():
    try:
        import yaml  # noqa: F401
    except ImportError:
        # shortcut: the venv has no PyYAML (rclpy needs it); Ubuntu's copy, appended after the venv so numpy stays the venv's
        sys.path.append("/usr/lib/python3/dist-packages")
    try:
        import rclpy  # noqa: F401
    except ImportError as e:
        raise RuntimeError("rclpy not importable: run `source /opt/ros/jazzy/setup.bash` first") from e


class RosBridge:
    def __init__(self, map_path: Path = MAP_OSM, node_name: str = "faultline_bridge"):
        self.map_path, self.node_name = Path(map_path), node_name
        self.node, self.tick_ms, self._stop = None, [], threading.Event()

    # ---- setup -------------------------------------------------------------------------------------------------
    def attach(self, world) -> None:
        """Call after world.reset() (the actors and any ChaseView hook exist then); fans out world.on_tick."""
        _import_ros()
        import rclpy
        from geometry_msgs.msg import TransformStamped
        from nav_msgs.msg import Odometry
        from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
        from rosgraph_msgs.msg import Clock
        from sensor_msgs.msg import JointState, PointCloud2, PointField
        from std_msgs.msg import Bool, Float64, String
        from tf2_msgs.msg import TFMessage
        from visualization_msgs.msg import MarkerArray

        self.M = dict(TransformStamped=TransformStamped, Odometry=Odometry, Clock=Clock, PointCloud2=PointCloud2,
                      PointField=PointField, Bool=Bool, Float64=Float64, String=String, TFMessage=TFMessage,
                      MarkerArray=MarkerArray, JointState=JointState)
        self._own_init = not rclpy.ok()
        if self._own_init:
            rclpy.init()
        n = self.node = rclpy.create_node(self.node_name)
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL,
                             reliability=ReliabilityPolicy.RELIABLE)
        self.pub = {"tf": n.create_publisher(TFMessage, "/tf", 10),
                    "tf_static": n.create_publisher(TFMessage, "/tf_static", latched),
                    "clock": n.create_publisher(Clock, "/clock", 10),
                    "lidar": n.create_publisher(PointCloud2, "/faultline/lidar", 5),
                    "tracks": n.create_publisher(MarkerArray, "/faultline/tracks", 5),
                    "gt": n.create_publisher(MarkerArray, "/faultline/gt", 5),
                    "odom": n.create_publisher(Odometry, "/faultline/ego/odom", 10),
                    "lanelet_map": n.create_publisher(MarkerArray, "/faultline/lanelet_map", latched)}
        for name in ("ego/speed", "ego/accel", "ego/steer", "adversary/speed", "gap_lidar", "gap_gt", "ttc"):
            self.pub[name] = n.create_publisher(Float64, f"/faultline/{name}", 10)
        for name in ("adversary_action", "decision", "mode"):
            self.pub[name] = n.create_publisher(String, f"/faultline/{name}", 10)
        self.pub["safe_halt"] = n.create_publisher(Bool, "/faultline/safe_halt", 10)
        # HMI plots: this run's whole history per message (JointState: position = sim time [s], velocity/effort =
        # values), plotted x-vs-y from the latest message, so the x axis is sim time and a new run replaces the curves
        for name in ("hmi/gap", "hmi/ttc") + tuple(f"hmi/speed/{c}" for c in HMI_SPEED_CARS):
            self.pub[name] = n.create_publisher(JointState, f"/faultline/{name}", 10)
        self.hist = {}

        self.world = world
        self.runup_s = getattr(getattr(world, "s", None), "runup_s", 3.0)
        self._t_s, self._last_wall, self._base_mode = 0.0, time.monotonic(), "RUNUP"
        self.pub["tf_static"].publish(lidar_static_tf())
        if self.map_path.exists():
            self.pub["lanelet_map"].publish(self._lanelet_markers())
        prev = world.on_tick
        world.on_tick = lambda w, s: (prev and prev(w, s), self.on_tick(w, s))
        self._stop.clear()
        self._thread = threading.Thread(target=self._mode_loop, daemon=True)
        self._thread.start()

    def _lanelet_markers(self):
        from geometry_msgs.msg import Point
        from visualization_msgs.msg import Marker, MarkerArray

        from faultline.lanelet_export import load
        m = load(self.map_path)
        borders, centres = Marker(), Marker()
        for i, (mk, ns, w, rgba) in enumerate(((borders, "borders", 0.15, (0.85, 0.85, 0.9, 0.9)),
                                               (centres, "centrelines", 0.08, (0.3, 0.6, 1.0, 0.7)))):
            mk.header.frame_id, mk.ns, mk.id, mk.type, mk.action = "map", ns, i, Marker.LINE_LIST, Marker.ADD
            mk.scale.x, mk.pose.orientation.w, mk.frame_locked = w, 1.0, True  # stamp 0: draw with the latest TF
            mk.color.r, mk.color.g, mk.color.b, mk.color.a = rgba
        for lt in m.laneletLayer:
            for b in (list(lt.leftBound), list(lt.rightBound)):  # lanelet2 linestrings do not slice
                for a, c in zip(b, b[1:]):
                    borders.points += [Point(x=a.x, y=a.y, z=a.z), Point(x=c.x, y=c.y, z=c.z)]
            cl = list(lt.centerline)
            for a, c in zip(cl, cl[1:]):
                centres.points += [Point(x=a.x, y=a.y, z=a.z), Point(x=c.x, y=c.y, z=c.z)]
        return MarkerArray(markers=[borders, centres])

    # ---- per tick ----------------------------------------------------------------------------------------------
    def _stamp(self, t_s):
        from builtin_interfaces.msg import Time
        sec = int(t_s)
        return Time(sec=sec, nanosec=int(round((t_s - sec) * 1e9)) % 1_000_000_000)

    def _box(self, ns, i, x, y, z, yaw_deg, length, width, height, rgba, stamp, text=None):
        from visualization_msgs.msg import Marker
        out = []
        mk = Marker()
        mk.header.frame_id, mk.header.stamp, mk.ns, mk.id = "map", stamp, ns, i
        mk.type, mk.action = Marker.CUBE, Marker.ADD
        mk.pose.position.x, mk.pose.position.y, mk.pose.position.z = to_map(x, y, z)
        (mk.pose.orientation.x, mk.pose.orientation.y, mk.pose.orientation.z,
         mk.pose.orientation.w) = yaw_quat(yaw_deg)
        mk.scale.x, mk.scale.y, mk.scale.z = length, width, height
        mk.color.r, mk.color.g, mk.color.b, mk.color.a = rgba
        out.append(mk)
        if text:
            tx = Marker()
            tx.header, tx.ns, tx.id, tx.type, tx.action = mk.header, ns + "_label", i, Marker.TEXT_VIEW_FACING, Marker.ADD
            tx.pose.position.x, tx.pose.position.y = mk.pose.position.x, mk.pose.position.y
            tx.pose.position.z, tx.pose.orientation.w = mk.pose.position.z + height / 2 + 0.8, 1.0
            tx.scale.z, tx.text = 0.9, text.replace("PDM-Lite", "AV stack")  # on screen the ego is the stack under test
            tx.color.r, tx.color.g, tx.color.b, tx.color.a = 1.0, 1.0, 1.0, 1.0
            out.append(tx)
        return out

    def _gt_box(self, actor, ns, i, rgba, stamp, label):
        tf, bb = actor.get_transform(), actor.bounding_box
        c = tf.transform(bb.location)
        e = bb.extent
        return self._box(ns, i, c.x, c.y, c.z, tf.rotation.yaw, 2 * e.x, 2 * e.y, 2 * e.z, rgba, stamp, label)

    def on_tick(self, world, st) -> None:
        t0 = time.perf_counter()
        M, P = self.M, self.pub
        stamp = self._stamp(st.t_s)
        P["clock"].publish(M["Clock"](clock=stamp))

        ego_tf = world.ego.get_transform()
        ex, ey, ez = to_map(ego_tf.location.x, ego_tf.location.y, ego_tf.location.z)
        q = yaw_quat(ego_tf.rotation.yaw)
        t = M["TransformStamped"]()
        t.header.frame_id, t.header.stamp, t.child_frame_id = "map", stamp, "ego"
        t.transform.translation.x, t.transform.translation.y, t.transform.translation.z = ex, ey, ez
        t.transform.rotation.x, t.transform.rotation.y, t.transform.rotation.z, t.transform.rotation.w = q
        P["tf"].publish(M["TFMessage"](transforms=[t]))

        od = M["Odometry"]()
        od.header.frame_id, od.header.stamp, od.child_frame_id = "map", stamp, "ego"
        od.pose.pose.position.x, od.pose.pose.position.y, od.pose.pose.position.z = ex, ey, ez
        o = od.pose.pose.orientation
        o.x, o.y, o.z, o.w = q
        od.twist.twist.linear.x = float(st.ego_v)
        P["odom"].publish(od)

        scan = getattr(world, "last_scan", None)
        if scan is not None:
            pts = lidar_points(scan.raw_data)
            pc = M["PointCloud2"]()
            pc.header.frame_id, pc.header.stamp = "lidar", stamp
            pc.height, pc.width, pc.is_bigendian, pc.is_dense = 1, len(pts), False, True
            pc.fields = [M["PointField"](name=nm, offset=off, datatype=M["PointField"].FLOAT32, count=1)
                         for nm, off in CLOUD_FIELDS]
            pc.point_step, pc.row_step = 16, 16 * len(pts)
            pc.data = array.array("B", pts.tobytes())  # array.array takes rclpy's memcpy path, a list would not
            P["lidar"].publish(pc)

        gt = self._gt_box(world.ego, "gt", 0, (0.2, 0.9, 0.3, 0.35), stamp, None)
        gt += self._gt_box(world.lead, "gt", 1, (1.0, 0.55, 0.1, 0.35), stamp, f"adversary GT {st.lead_v:.1f} m/s")
        P["gt"].publish(M["MarkerArray"](markers=gt))

        from visualization_msgs.msg import Marker
        clear = Marker()
        clear.action = Marker.DELETEALL
        tracks = [clear]
        for tr in getattr(world, "tracks", None) or []:
            # faultline.ego.lidar_tracker.Track: CARLA world frame, yaw in degrees (carla.Rotation convention)
            z = (getattr(tr, "z", 0.0) or ego_tf.location.z) + 0.8
            tracks += self._box("tracks", int(_f(tr, "id")), _f(tr, "x"), _f(tr, "y"), z,
                                _f(tr, "yaw"), _f(tr, "length"), _f(tr, "width"), 1.6, (0.1, 0.8, 1.0, 0.6), stamp,
                                f"track {_f(tr, 'id')} {float(_f(tr, 'speed')):.1f} m/s")
        P["tracks"].publish(M["MarkerArray"](markers=tracks))

        F, S = M["Float64"], M["String"]
        ctl = world.ego.get_control() if hasattr(world.ego, "get_control") else None
        for name, v in (("ego/speed", st.ego_v), ("ego/accel", st.ego_a), ("ego/steer", ctl.steer if ctl else 0.0),
                        ("adversary/speed", st.lead_v), ("gap_gt", st.gt_gap),
                        ("gap_lidar", math.nan if st.lidar_gap is None else st.lidar_gap),
                        ("ttc", ttc(st.lidar_gap, st.lidar_closing))):
            P[name].publish(F(data=float(v)))
        advs = getattr(world, "advs", None)  # swarm world: every attacker; otherwise the single adversary
        rows = {"hmi/gap": (math.nan if st.lidar_gap is None else st.lidar_gap,
                            math.nan if st.gt_gap is None else st.gt_gap),
                "hmi/ttc": (ttc(st.lidar_gap, st.lidar_closing), TTC_LINE_S), "hmi/speed/ego": (st.ego_v, 0.0)}
        for c, v in ({c: a.v for c, a in advs.items()} if advs else {"adversary": st.lead_v}).items():
            if f"hmi/speed/{c}" in P:
                rows[f"hmi/speed/{c}"] = (v, 0.0)
        self._n_tick = getattr(self, "_n_tick", -1) + 1
        if self._n_tick % HMI_EVERY == 0:
            for name, (a, b) in rows.items():
                h = push_history(self.hist.setdefault(name, ([], [], [])), (st.t_s, a, b))
                js = M["JointState"]()
                js.header.stamp, js.header.frame_id = stamp, "map"
                js.position, js.velocity, js.effort = h
                P[name].publish(js)
        d = getattr(world, "last_decision", None)
        base = mode_of(d, st.t_s, self.runup_s, stalled=False)
        P["adversary_action"].publish(S(data="RUNUP" if d is None else (d.get("action") or "SAFE_HALT")))
        P["decision"].publish(S(data=decision_line(d)))
        P["safe_halt"].publish(M["Bool"](data=base == "SAFE_HALT"))
        P["mode"].publish(S(data=base))
        self._t_s, self._base_mode, self._decision, self._last_wall = st.t_s, base, d, time.monotonic()
        self.tick_ms.append((time.perf_counter() - t0) * 1e3)

    def _mode_loop(self):
        """While the loop waits for a checkpoint decision no tick arrives; show that as AWAITING_0G."""
        while not self._stop.wait(0.1):
            stalled = time.monotonic() - self._last_wall > STALL_S and bool(getattr(self.world, "actors", True))
            m = mode_of(getattr(self, "_decision", None), self._t_s, self.runup_s, stalled)
            if m == "AWAITING_0G":
                self.pub["mode"].publish(self.M["String"](data=m))

    def stats(self) -> dict:
        a = np.array(self.tick_ms or [0.0])
        return {"ticks": len(self.tick_ms), "mean_ms": float(a.mean()), "p95_ms": float(np.percentile(a, 95)),
                "max_ms": float(a.max())}

    def close(self) -> None:
        self._stop.set()
        if getattr(self, "_thread", None):
            self._thread.join(timeout=1.0)
        if self.node:
            import rclpy
            self.node.destroy_node()
            self.node = None
            if self._own_init and rclpy.ok():
                rclpy.shutdown()
