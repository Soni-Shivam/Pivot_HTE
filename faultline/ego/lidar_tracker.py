"""LiDAR object tracker that replaces PDM-Lite's privileged actor list.

Input: the ego's LiDAR points in route coordinates (s = arc length along the route, l = lateral offset from the ego
lane centre, positive to the left, h = height above the road). Steps: ground/ROI filter -> BEV grid clustering
(8-connected) -> lane-aligned box per cluster, grown from its visible near edges to a car-sized prior (LiDAR sees only
the faces turned towards it) -> nearest-neighbour association -> alpha-beta (constant-velocity) filter on the box
centre. Yaw comes from the filtered velocity relative to the lane heading, smoothed, and snapped to the lane heading
when the object is slow (heading from velocity is noise there). Output tracks duck-type the carla.Actor methods that
PDM-Lite reads. No ground truth is used anywhere in this module.
"""
import math
from dataclasses import dataclass, field

import numpy as np

CELL_M = 0.5
MIN_POINTS = 3
H_MIN, H_MAX = 0.3, 2.5  # m above the road: below is ground, above is not a car
LEN_PRIOR, WID_PRIOR, HALF_HEIGHT = 4.6, 1.9, 0.75
GATE_M = 2.5
ALPHA, BETA = 0.6, 0.25
CONFIRM_HITS, MAX_MISSES = 3, 4
YAW_EMA, YAW_CLIP_DEG, SLOW_MPS = 0.3, 40.0, 2.0


def cluster_bev(sl: np.ndarray, cell: float = CELL_M, min_points: int = MIN_POINTS) -> list[np.ndarray]:
    """Index arrays of 8-connected occupied grid cells over BEV points (N x 2); clusters below min_points dropped."""
    if len(sl) == 0:
        return []
    keys = np.floor(sl / cell).astype(np.int64)
    cells: dict[tuple, list] = {}
    for i, k in enumerate(map(tuple, keys)):
        cells.setdefault(k, []).append(i)
    seen, out = set(), []
    for start in cells:
        if start in seen:
            continue
        stack, members = [start], []
        seen.add(start)
        while stack:
            c = stack.pop()
            members += cells[c]
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (c[0] + dx, c[1] + dy)
                    if n in cells and n not in seen:
                        seen.add(n)
                        stack.append(n)
        if len(members) >= min_points:
            out.append(np.array(sorted(members)))
    return out


def fit_box(sl: np.ndarray, sensor_sl: tuple[float, float]) -> tuple[float, float, float, float]:
    """Lane-aligned box (s_centre, l_centre, length, width) of one cluster seen from the sensor at `sensor_sl`.
    Faces turned away from the sensor are not observed, so the box grows away from the sensor to the car prior."""
    s0, s1 = sl[:, 0].min(), sl[:, 0].max()
    l0, l1 = sl[:, 1].min(), sl[:, 1].max()
    ss, ls = sensor_sl
    if s0 > ss:  # ahead: rear face seen
        s1 = max(s1, s0 + LEN_PRIOR)
    elif s1 < ss:  # behind: front face seen
        s0 = min(s0, s1 - LEN_PRIOR)
    else:
        c = (s0 + s1) / 2
        s0, s1 = min(s0, c - LEN_PRIOR / 2), max(s1, c + LEN_PRIOR / 2)
    if l0 > ls:  # to the left: right side seen
        l1 = max(l1, l0 + WID_PRIOR)
    elif l1 < ls:
        l0 = min(l0, l1 - WID_PRIOR)
    else:  # straddles the sensor's line: the full width of the facing side is visible
        c = (l0 + l1) / 2
        l0, l1 = min(l0, c - WID_PRIOR / 2), max(l1, c + WID_PRIOR / 2)
    return (s0 + s1) / 2, (l0 + l1) / 2, s1 - s0, l1 - l0


@dataclass
class Track:
    """One tracked object. World-frame fields (x, y, z, yaw deg, length, width, speed) are filled by the tracker's
    `to_world`; the carla.Actor-like methods below are what PDM-Lite calls."""
    id: int
    s: float
    l: float
    vs: float = 0.0
    vl: float = 0.0
    length: float = LEN_PRIOR
    width: float = WID_PRIOR
    hits: int = 1
    misses: int = 0
    rel_yaw_deg: float = 0.0
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    yaw: float = 0.0
    speed: float = 0.0
    attributes: dict = field(default_factory=dict)
    type_id: str = "lidar_track"

    def get_location(self):
        import carla
        return carla.Location(x=self.x, y=self.y, z=self.z)

    def get_transform(self):
        import carla
        return carla.Transform(self.get_location(), carla.Rotation(yaw=self.yaw))

    def get_velocity(self):
        import carla
        r = math.radians(self.yaw)
        return carla.Vector3D(x=self.speed * math.cos(r), y=self.speed * math.sin(r), z=0.0)

    @property
    def bounding_box(self):
        import carla
        return carla.BoundingBox(carla.Location(), carla.Vector3D(x=self.length / 2, y=self.width / 2, z=HALF_HEIGHT))

    def get_control(self):
        import carla
        return carla.VehicleControl()  # unknown for a LiDAR track: zeros, so PDM-Lite forecasts constant velocity

    def as_dict(self) -> dict:
        return {k: round(float(getattr(self, k)), 3) for k in ("x", "y", "yaw", "length", "width", "speed")} | {
            "id": self.id}


class LidarTracker:
    """`to_world(s, l) -> (x, y, z, route_yaw_deg)` maps route coordinates to the world (None = leave world fields 0)."""

    def __init__(self, dt_s: float, l_max: float, to_world=None):
        self.dt, self.l_max, self.to_world = dt_s, l_max, to_world
        self.tracks: list[Track] = []
        self.next_id = 1

    def detect(self, slh: np.ndarray, sensor_sl, ego_sl=None, ego_half=(2.6, 1.2)) -> list[tuple]:
        ss, ls = sensor_sl
        m = (slh[:, 2] >= H_MIN) & (slh[:, 2] <= H_MAX) & (np.abs(slh[:, 1]) <= self.l_max) & \
            (slh[:, 0] - ss >= -20.0) & (slh[:, 0] - ss <= 60.0)
        if ego_sl is not None:  # never cluster the ego's own body
            m &= ~((np.abs(slh[:, 0] - ego_sl[0]) <= ego_half[0]) & (np.abs(slh[:, 1] - ego_sl[1]) <= ego_half[1]))
        sl = slh[m, :2]
        return [fit_box(sl[idx], sensor_sl) for idx in cluster_bev(sl)]

    def update(self, slh: np.ndarray, sensor_sl, ego_sl=None, z_world: float = 0.0) -> list[Track]:
        dets = self.detect(slh, sensor_sl, ego_sl)
        dt = self.dt
        for t in self.tracks:  # predict
            t.s += t.vs * dt
            t.l += t.vl * dt
        free = list(range(len(dets)))
        for t in sorted(self.tracks, key=lambda t: -t.hits):  # greedy nearest neighbour, older tracks first
            if not free:
                t.misses += 1
                continue
            j = min(free, key=lambda j: math.hypot(dets[j][0] - t.s, dets[j][1] - t.l))
            ds, dl = dets[j][0] - t.s, dets[j][1] - t.l
            if math.hypot(ds, dl) > GATE_M:
                t.misses += 1
                continue
            free.remove(j)
            if t.hits == 1:  # second measurement: initialise the velocity from the displacement
                t.vs, t.vl = t.vs + ds / dt, t.vl + dl / dt
                t.s, t.l = dets[j][0], dets[j][1]
            else:
                t.s, t.l = t.s + ALPHA * ds, t.l + ALPHA * dl
                t.vs, t.vl = t.vs + BETA * ds / dt, t.vl + BETA * dl / dt
            t.length, t.width = dets[j][2], dets[j][3]
            t.hits += 1
            t.misses = 0
        for j in free:
            self.tracks.append(Track(id=self.next_id, s=dets[j][0], l=dets[j][1], length=dets[j][2], width=dets[j][3]))
            self.next_id += 1
        self.tracks = [t for t in self.tracks if t.misses <= MAX_MISSES and (t.hits > 1 or t.misses == 0)]
        out = []
        for t in self.tracks:
            t.speed = math.hypot(t.vs, t.vl)
            if t.speed < SLOW_MPS:
                t.rel_yaw_deg = 0.0
            else:
                raw = max(-YAW_CLIP_DEG, min(YAW_CLIP_DEG, math.degrees(math.atan2(t.vl, t.vs))))
                t.rel_yaw_deg += YAW_EMA * (raw - t.rel_yaw_deg)
            if self.to_world is not None:
                t.x, t.y, z, route_yaw = self.to_world(t.s, t.l)
                t.z = z_world
                t.yaw = route_yaw - t.rel_yaw_deg  # CARLA yaw is clockwise; l is positive to the left
            if t.hits >= CONFIRM_HITS:
                out.append(t)
        return out
