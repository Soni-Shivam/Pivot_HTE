"""Compatibility checker: what of a stack fits Faultline and what does not, plus the stack artifact digest.

python -m faultline.stack check stacks/pdm_lite.yaml      (or module:Class)
python -m faultline.stack digest stacks/pdm_lite.yaml     (prints only the 0x digest)
"""
import hashlib
import importlib
import json
import math
import statistics
import sys
import time
from pathlib import Path

import numpy as np

from faultline.stack.interface import SENSOR_BLUEPRINTS, Control, EgoState, SensorSpec
from faultline.stack.mission import Mission

ROOT = Path(__file__).resolve().parents[2]
DT_S = 0.05
# carla_garage/leaderboard/leaderboard/autoagents/agent_wrapper.py (Leaderboard 2.0, MIT): SENSORS_LIMITS and
# MAX_ALLOWED_RADIUS_SENSOR, applied here to the sensor types the bridge supports
SENSOR_LIMITS = {"lidar": 2, "camera": 8, "gnss": 1, "imu": 1, "odometry": 1}
MAX_MOUNT_RADIUS_M = 3.0


def load_spec(path: str) -> dict:
    p = Path(path)
    if p.suffix == ".json":
        return json.loads(p.read_text())
    try:
        import yaml
    except ImportError:  # shortcut: the venv has no PyYAML (no new deps); Ubuntu's copy, as faultline/rosbridge.py does
        sys.path.append("/usr/lib/python3/dist-packages")
        import yaml
    return yaml.safe_load(p.read_text())


def _cls(entry: str):
    mod, _, name = entry.partition(":")
    return getattr(importlib.import_module(mod), name)


def resolve(target: str) -> tuple[dict, callable]:
    """spec dict and a factory giving a fresh stack instance."""
    if target.endswith((".yaml", ".yml", ".json")):
        spec = load_spec(target)
    else:
        cls = _cls(target)
        spec = {"name": getattr(cls, "name", cls.__name__), "adapter": "python", "entry": target,
                "files": list(getattr(cls, "files", ())) or [importlib.import_module(target.split(":")[0]).__file__]}
    a = spec.get("adapter", "python")
    if a == "python":
        factory = lambda: _cls(spec["entry"])()
    elif a == "leaderboard":
        from faultline.stack.adapters import LeaderboardAgentStack
        factory = lambda: LeaderboardAgentStack(_cls(spec["entry"]), spec.get("config", ""))
    elif a == "ros2":
        from faultline.stack.adapters import RosStack
        factory = lambda: RosStack([SensorSpec(**d) for d in spec.get("sensors", [])], spec.get("control", "ackermann"),
                                   float(spec.get("latency_budget_s", 0.2)), spec.get("name", "ros2-stack"))
    else:
        raise ValueError(f"unknown adapter {a!r} (python | leaderboard | ros2)")
    return spec, factory


def digest(files: list[str], root: Path = ROOT) -> str:
    """One file: sha256 of its bytes (what packages/hedera's policy commitment is today, for pdm_lite.py).
    Several: sha256 of their `sha256sum` lines sorted by path, i.e. `sha256sum <files> | sort -k2 | sha256sum`."""
    hs = sorted((str(f), hashlib.sha256((root / f).read_bytes()).hexdigest()) for f in files)
    if len(hs) == 1:
        return "0x" + hs[0][1]
    return "0x" + hashlib.sha256("".join(f"{h}  {f}\n" for f, h in hs).encode()).hexdigest()


def check_sensors(sensors: list[SensorSpec], blueprints=None) -> list[tuple[str, str, str]]:
    """[(status ok|warn|fail, item, detail)]. blueprints: carla BlueprintLibrary or None (live check skipped)."""
    out, counts, ids = [], {}, set()
    for s in sensors:
        item = f"sensor {s.id} ({s.type})"
        if s.type not in SENSOR_BLUEPRINTS:
            out.append(("fail", item, f"type not supported (supported: {', '.join(SENSOR_BLUEPRINTS)}); "
                                      "privileged object lists are never provided"))
            continue
        if s.id in ids:
            out.append(("fail", item, "duplicate sensor id"))
        ids.add(s.id)
        counts[s.type] = counts.get(s.type, 0) + 1
        r = math.sqrt(s.x ** 2 + s.y ** 2 + s.z ** 2)
        if r > MAX_MOUNT_RADIUS_M:
            out.append(("fail", item, f"mount {r:.2f} m from the ego origin > {MAX_MOUNT_RADIUS_M} m (Leaderboard rule)"))
        k = (1 / DT_S) / s.rate_hz if s.rate_hz > 0 else math.inf
        if s.rate_hz >= 1 / DT_S - 1e-6:
            out.append(("ok" if s.rate_hz <= 1 / DT_S + 1e-6 else "warn", item,
                        f"rate {s.rate_hz:g} Hz -> every tick (dt {DT_S} s)" +
                        ("" if s.rate_hz <= 1 / DT_S + 1e-6 else "; capped at 20 Hz in sync mode")))
        elif abs(k - round(k)) < 1e-6:
            out.append(("ok", item, f"rate {s.rate_hz:g} Hz -> every {round(k)} ticks"))
        else:
            out.append(("warn", item, f"rate {s.rate_hz:g} Hz is not 20/n: CARLA delivers at the next tick after each "
                                      "sensor_tick, so intervals jitter by up to 0.05 s"))
        bpn = SENSOR_BLUEPRINTS[s.type]
        if bpn and blueprints is not None:
            bp = blueprints.find(bpn)
            for key, v in s.params.items():
                if not bp.has_attribute(key):
                    out.append(("fail", item, f"attribute {key!r} does not exist on {bpn} in this CARLA"))
                else:
                    rec = list(bp.get_attribute(key).recommended_values)
                    if len(rec) > 1 and str(v) not in rec:  # a single value is just the default
                        out.append(("warn", item, f"{key}={v} not in recommended {rec}"))
            out.append(("ok", item, f"{bpn} present in the live blueprint library, {len(s.params)} attributes checked"))
        elif bpn:
            out.append(("warn", item, "live blueprint check skipped (CARLA not reachable)"))
    for t, n in counts.items():
        if n > SENSOR_LIMITS[t]:
            out.append(("fail", f"sensors {t}", f"{n} declared > limit {SENSOR_LIMITS[t]}"))
    return out


def synthetic(sensors: list[SensorSpec], n: int):
    """Open-loop dry inputs: straight route along +x, ego at 8 m/s, a car-sized point cluster 20 m ahead in the ego
    lane for LiDARs, zero images. Seeded, so two runs feed identical bytes."""
    route = tuple((2.0 * i, 0.0, 0.0) for i in range(200))
    mission = Mission("synthetic-straight", (0.0, 0.0, 0.0), 0.0, route, dt_s=DT_S)
    rng = np.random.default_rng(0)
    steps = []
    for k in range(n):
        ex = 5.0 + 8.0 * DT_S * k
        ego = EgoState(x=ex, y=0.0, z=0.0, yaw_deg=0.0, speed_mps=8.0)
        obs = {}
        for s in sensors:
            if s.type == "lidar":
                m = rng.uniform([0, -0.9, 0.4], [4.5, 0.9, 1.5], size=(300, 3))
                m[:, 0] += 25.0 + 4.0 * DT_S * k - ex - s.x  # lead at 4 m/s, so the gap closes
                m[:, 2] -= s.z
                obs[s.id] = (k, np.column_stack([m, np.ones(len(m))]).astype(np.float32))
            elif s.type == "camera":
                obs[s.id] = (k, np.zeros((int(s.params.get("image_size_y", 600)), int(s.params.get("image_size_x", 800)), 4),
                                         dtype=np.uint8))
            elif s.type == "gnss":
                obs[s.id] = (k, np.zeros(3))
            elif s.type == "imu":
                obs[s.id] = (k, np.zeros(7))
            elif s.type == "odometry":
                obs[s.id] = (k, {"speed": 8.0})
        steps.append((obs, ego, round(k * DT_S, 6)))
    return mission, steps


def dry_run(factory, n: int = 40):
    st = factory()
    sensors = st.sensors()
    mission, steps = synthetic(sensors, n)
    st.setup(mission, str(ROOT / "maps" / "Town10HD_Opt.osm"))
    ctl, lat = [], []
    try:
        for obs, ego, t in steps:
            t0 = time.perf_counter()
            c = st.run_step(obs, ego, t)
            lat.append(time.perf_counter() - t0)
            ctl.append(c)
    finally:
        st.destroy()
    dry_run.timeouts = getattr(st, "timeouts", 0)  # ROS adapter: steps with no control within the budget
    return ctl, lat


def check(target: str, n: int = 40, blueprints="live") -> dict:
    spec, factory = resolve(target)
    budget = float(spec.get("latency_budget_s", 0.1))
    rows = []
    try:
        sensors = factory().sensors()
    except Exception as e:  # noqa: BLE001 - reported, not raised: the checker's job is to say what does not fit
        return {"name": spec.get("name"), "rows": [("fail", "sensors()", repr(e))], "ok": False,
                "digest": digest(spec.get("files", []))}
    if blueprints == "live":
        try:
            import carla
            c = carla.Client("127.0.0.1", 2000)
            c.set_timeout(10.0)
            blueprints = c.get_world().get_blueprint_library()  # read-only; no lock, no tick, no settings change
        except Exception:  # noqa: BLE001
            blueprints = None
    rows += check_sensors(sensors, blueprints)
    if not any(s.type == "odometry" for s in sensors):
        rows.append(("ok", "proprioception", "EgoState (pose, speed, accel, dimensions) is passed every step anyway"))
    try:
        ctl, lat = dry_run(factory, n)
    except Exception as e:  # noqa: BLE001
        rows.append(("fail", "dry run", repr(e)))
        return {"name": spec.get("name"), "adapter": spec.get("adapter", "python"), "rows": rows, "ok": False,
                "digest": digest(spec.get("files", [])) if spec.get("files") else None}
    if dry_run.timeouts:
        rows.append(("warn", "stack timeouts", f"{dry_run.timeouts}/{n} steps had no control within the budget "
                                               "(braked); usually the first step while the stack subscribes"))
    bad = [(i, c.problems() if isinstance(c, Control) else [f"returned {type(c).__name__}, not Control"])
           for i, c in enumerate(ctl)]
    bad = [b for b in bad if b[1]]
    rows.append(("fail" if bad else "ok", "control interface",
                 f"{len(bad)}/{n} steps out of range, first: {bad[0]}" if bad else
                 f"{n}/{n} steps returned Control(throttle, brake, steer) in range"))
    if any(isinstance(c, Control) and c.brake > 0 for c in ctl):
        rows.append(("ok", "reacts to the synthetic closing lead", f"brakes at step {next(i for i, c in enumerate(ctl) if c.brake > 0)}"))
    else:
        rows.append(("warn", "reacts to the synthetic closing lead", "never braked in the dry run (check perception)"))
    p50, p95 = statistics.median(lat), sorted(lat)[max(int(0.95 * len(lat)) - 1, 0)]
    rows.append(("ok" if p95 <= budget else "fail", "latency",
                 f"p50 {p50 * 1e3:.1f} ms, p95 {p95 * 1e3:.1f} ms, max {max(lat) * 1e3:.1f} ms vs budget {budget * 1e3:.0f} ms"))
    ctl2, _ = dry_run(factory, n)
    same = [(c.throttle, c.brake, c.steer) for c in ctl] == [(c.throttle, c.brake, c.steer) for c in ctl2]
    rows.append(("ok" if same else "warn", "determinism",
                 "two fresh instances, same inputs -> identical controls" if same else
                 "outputs differ between two identical dry runs: results will not replay bit-exactly"))
    files = spec.get("files", [])
    d = digest(files) if files else None
    rows.append(("ok" if d else "fail", "stack artifact digest", f"{d} over {len(files)} files" if d else "no files declared"))
    return {"name": spec.get("name"), "adapter": spec.get("adapter", "python"), "rows": rows, "digest": d,
            "ok": not any(r[0] == "fail" for r in rows), "latency_ms": {"p50": round(p50 * 1e3, 2), "p95": round(p95 * 1e3, 2)}}


def render(rep: dict) -> str:
    lines = [f"stack {rep['name']} (adapter {rep.get('adapter', '?')})"]
    lines += [f"  [{s.upper():4}] {item}: {detail}" for s, item, detail in rep["rows"]]
    lines.append(f"  RESULT: {'COMPATIBLE' if rep['ok'] else 'NOT COMPATIBLE'}  digest {rep['digest']}")
    return "\n".join(lines)
