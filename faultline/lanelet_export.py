"""Lanelet2 map of the live CARLA map (read-only, no ticking): one Lanelet per driving lane segment, junction
connectors included, in the right-handed ROS `map` frame (x = x_carla, y = -y_carla).

    source /opt/ros/jazzy/setup.bash && .venv/bin/python -m faultline.lanelet_export   # -> maps/Town10HD_Opt.osm
"""
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "maps" / "Town10HD_Opt.osm"
STEP_M = 1.0


def _lanelet2():
    import lanelet2  # ROS Jazzy's bindings: needs `source /opt/ros/jazzy/setup.bash` (PYTHONPATH + LD_LIBRARY_PATH)
    return lanelet2


def lane_borders(samples):
    """samples: [(x, y, z, yaw_deg, width)] along one lane in CARLA coords (driving order). Returns (left, right,
    centre) as [(x, y, z)] in the map frame. CARLA's right vector is (-sin yaw, cos yaw) in its own frame; the y flip
    keeps physical left/right, which is what Lanelet2's left/right bound mean."""
    left, right, centre = [], [], []
    for x, y, z, yaw, w in samples:
        rx, ry = -math.sin(math.radians(yaw)), math.cos(math.radians(yaw))
        h = w / 2
        centre.append((x, -y, z))
        left.append((x - rx * h, -(y - ry * h), z))
        right.append((x + rx * h, -(y + ry * h), z))
    return left, right, centre


def build_map(lanes):
    """lanes: {key: samples} (see lane_borders). One Lanelet per key, tagged with the CARLA road/section/lane id."""
    _lanelet2()
    from lanelet2.core import AttributeMap, Lanelet, LaneletMap, LineString3d, Point3d, getId

    m = LaneletMap()
    for key, samples in lanes.items():
        if len(samples) < 2:
            continue
        left, right, _ = lane_borders(samples)
        ls = [LineString3d(getId(), [Point3d(getId(), *p) for p in side], AttributeMap({"type": "line_thin",
                                                                                         "subtype": "solid"}))
              for side in (left, right)]
        attrs = {"type": "lanelet", "subtype": "road", "location": "urban", "one_way": "yes",
                 "participant:vehicle": "yes", "carla_id": "/".join(map(str, key))}
        m.add(Lanelet(getId(), ls[0], ls[1], AttributeMap(attrs)))
    return m


def projector():
    _lanelet2()
    from lanelet2.io import Origin
    from lanelet2.projection import LocalCartesianProjector
    return LocalCartesianProjector(Origin(0.0, 0.0))


def write(m, path: Path) -> None:
    from lanelet2.io import write as ll_write
    path.parent.mkdir(parents=True, exist_ok=True)
    ll_write(str(path), m, projector())


def load(path: Path = OUT):
    _lanelet2()
    from lanelet2.io import load as ll_load
    return ll_load(str(path), projector())


def carla_lanes(cmap):
    """Every driving lane segment of a carla.Map (topology start points, deduplicated), sampled every STEP_M."""
    lanes = {}
    for start, _ in cmap.get_topology():
        key = (start.road_id, start.section_id, start.lane_id)
        if key in lanes:
            continue
        chain = [start] + start.next_until_lane_end(STEP_M)
        lanes[key] = [(w.transform.location.x, w.transform.location.y, w.transform.location.z,
                       w.transform.rotation.yaw, w.lane_width) for w in chain]
    return lanes


def main(host="127.0.0.1", port=2000):
    import carla
    c = carla.Client(host, port)
    c.set_timeout(60.0)
    cmap = c.get_world().get_map()
    lanes = carla_lanes(cmap)
    write(build_map(lanes), OUT)
    m = load(OUT)
    # round trip: first centre sample of one lane vs the reloaded left/right midpoint
    key, s = next(iter(lanes.items()))
    (cx, cy, _), = lane_borders(s[:1])[2]
    lt = next(x for x in m.laneletLayer if x.attributes["carla_id"] == "/".join(map(str, key)))
    mx, my = (lt.leftBound[0].x + lt.rightBound[0].x) / 2, (lt.leftBound[0].y + lt.rightBound[0].y) / 2
    err = math.hypot(mx - cx, my - cy)
    print(f"{cmap.name}: {len(lanes)} lanes -> {len(m.laneletLayer)} lanelets in {OUT}; round-trip error {err * 100:.3f} cm")
    assert len(m.laneletLayer) == len(lanes) and err < 0.01


if __name__ == "__main__":
    main()
