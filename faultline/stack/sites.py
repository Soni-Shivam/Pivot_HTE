"""Validated spawn sites on Town10HD_Opt: the start of a junction-free, near-straight stretch where the ego lane has
a same-direction driving lane on its left (the cut-in adversary's lane).

`scan()` reads the live map (read-only; nothing is spawned or ticked) and checks each candidate stretch:
lane ids, widths (equal, constant), junction-free length, yaw drift, and no static obstacle in either lane's
corridor (world.cast_ray along both lane centres at 0.5 m and 1.2 m height; hits on road surface classes are
ignored). The result is frozen in sites_town10.json; `select(seed, family)` picks one deterministically and the
chosen site id goes into the scenario (and so the scenario hash).
"""
import json
import math
from pathlib import Path

CATALOGUE = Path(__file__).with_name("sites_town10.json")
MIN_LEN_M = {"cut_in": 60.0}  # adversary starts 12 m ahead and needs ~2-3 s of lane change at ~9 m/s
STEP_M, MAX_LEN_M, MAX_YAW_DRIFT_DEG, START_MARGIN_M = 2.0, 120.0, 4.0, 4.0
GROUND = ("Roads", "RoadLines", "Ground", "Sidewalks", "Terrain", "NONE", "Sky", "Water")


def _yd(a, b):
    return abs((a - b + 180) % 360 - 180)


def _pair_ok(wp, carla, width):
    left = wp.get_left_lane()
    return (left is not None and left.lane_type == carla.LaneType.Driving and left.lane_id * wp.lane_id > 0
            and abs(wp.lane_width - width) < 0.05 and abs(left.lane_width - width) < 0.05)


def run_from(wp, carla):
    """Straight two-lane stretch from wp: list of ego-lane waypoints (2 m apart) while the pair holds."""
    w0, yaw0, out = wp.lane_width, wp.transform.rotation.yaw, [wp]
    while len(out) * STEP_M < MAX_LEN_M:
        nxt = out[-1].next(STEP_M)
        if not nxt or nxt[0].is_junction or not _pair_ok(nxt[0], carla, w0) \
                or _yd(nxt[0].transform.rotation.yaw, yaw0) > MAX_YAW_DRIFT_DEG:
            break
        out.append(nxt[0])
    return out


def obstacles(world, run, carla) -> list[str]:
    ground = {getattr(carla.CityObjectLabel, g) for g in GROUND}
    hits = []
    for lane in (run, [w.get_left_lane() for w in run]):
        for h in (0.5, 1.2):
            for a, b in zip(lane[:-1], lane[1:]):
                pa, pb = a.transform.location, b.transform.location
                for p in world.cast_ray(carla.Location(pa.x, pa.y, pa.z + h), carla.Location(pb.x, pb.y, pb.z + h)):
                    if p.label not in ground:
                        hits.append(f"{p.label} at ({p.location.x:.1f}, {p.location.y:.1f})")
    return hits


def scan(world, carla) -> list[dict]:
    m = world.get_map()
    seen, sites = set(), []
    for wp in sorted(m.generate_waypoints(STEP_M), key=lambda w: (w.road_id, w.section_id, w.lane_id, w.s)):
        if wp.lane_type != carla.LaneType.Driving or wp.is_junction or not _pair_ok(wp, carla, wp.lane_width):
            continue
        prev = wp.previous(STEP_M)
        if prev and not prev[0].is_junction and _pair_ok(prev[0], carla, wp.lane_width) \
                and _yd(prev[0].transform.rotation.yaw, wp.transform.rotation.yaw) < 1.0:
            continue  # not the start of a stretch
        run = run_from(wp, carla)
        key = (run[0].road_id, run[0].lane_id, round(run[0].transform.location.x), round(run[0].transform.location.y))
        if key in seen:
            continue
        seen.add(key)
        length = (len(run) - 1) * STEP_M
        k = int(START_MARGIN_M // STEP_M)
        if length - START_MARGIN_M < min(MIN_LEN_M.values()):
            continue
        start, obs = run[k], obstacles(world, run[k:], carla)
        loc = start.transform.location
        sites.append({"id": f"r{start.road_id}l{start.lane_id}s{int(start.s)}", "road": start.road_id,
                      "lane": start.lane_id, "left_lane": start.get_left_lane().lane_id,
                      "lane_width_m": round(start.lane_width, 3), "straight_m": length - k * STEP_M,
                      "start_xyz": [round(loc.x, 3), round(loc.y, 3), round(loc.z, 3)],
                      "yaw_deg": round(start.transform.rotation.yaw, 3), "obstacles": obs[:5],
                      "families": [f for f, n in MIN_LEN_M.items() if length - k * STEP_M >= n and not obs]})
    return dedupe(sites)


def dedupe(sites: list[dict], radius_m: float = 6.0) -> list[dict]:
    """Starts a waypoint or two apart on the same lane are one site: keep the longest stretch."""
    kept = []
    for s in sorted(sites, key=lambda s: (-s["straight_m"], s["id"])):
        if not any(k["road"] == s["road"] and k["lane"] == s["lane"] and
                   math.dist(k["start_xyz"][:2], s["start_xyz"][:2]) < radius_m for k in kept):
            kept.append(s)
    return sorted(kept, key=lambda s: s["id"])


def load(path: Path = CATALOGUE) -> list[dict]:
    return json.loads(Path(path).read_text())["sites"]


def select(seed: int, family: str = "cut_in", sites: list[dict] | None = None) -> dict:
    ok = sorted((s for s in (sites if sites is not None else load()) if family in s["families"]), key=lambda s: s["id"])
    if not ok:
        raise ValueError(f"no validated site for {family}")
    return ok[seed % len(ok)]


def by_id(site_id: str, sites: list[dict] | None = None) -> dict:
    return next(s for s in (sites if sites is not None else load()) if s["id"] == site_id)


if __name__ == "__main__":
    import carla
    c = carla.Client("127.0.0.1", 2000)
    c.set_timeout(60.0)
    w = c.get_world()
    assert "Town10HD_Opt" in w.get_map().name, "scan expects Town10HD_Opt loaded (never reloads the map)"
    found = scan(w, carla)
    CATALOGUE.write_text(json.dumps({"map": w.get_map().name, "method": __doc__.strip().splitlines()[0],
                                     "sites": found}, indent=1) + "\n")
    for s in found:
        print(s["id"], s["lane_width_m"], s["straight_m"], s["families"], s["obstacles"][:2])
