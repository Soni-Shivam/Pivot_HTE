import hashlib
import json
import math
import types

import numpy as np
import pytest

from faultline.stack import sites
from faultline.stack.adapters import LeaderboardAgentStack, RosStack, UnsupportedSensor, from_leaderboard_sensor
from faultline.stack.arena import ScriptDecider
from faultline.stack.check import check_sensors, digest, dry_run, resolve, synthetic
from faultline.stack.interface import AVStack, Control, EgoState, SensorSpec, ackermann_to_control, twist_to_control
from faultline.stack.mission import Mission, mission_metrics

EGO = EgoState(x=0, y=0, z=0, yaw_deg=0, speed_mps=5.0)
M = Mission("t", (0, 0, 0), 0.0, tuple((2.0 * i, 0.0, 0.0) for i in range(100)), goal_m=50.0, time_limit_s=12.0)


def rows(vs, lat=0.0, collision_at=None, dt=0.5):
    out, x = [], 0.0
    for i, v in enumerate(vs):
        x += v * dt
        out.append({"t_s": (i + 1) * dt, "ego_x": x, "ego_v": v, "ego_lat_m": lat,
                    "collision": collision_at is not None and i >= collision_at})
    return out


def test_control_range_and_conversions():
    assert Control(0.5, 0.0, -1.0).problems() == []
    assert Control(1.2, 0.0, 0.0).problems() and Control(0, 0, float("nan")).problems()
    c = ackermann_to_control(10.0, math.radians(7.0), EGO)  # faster target, 7 deg left
    assert c.throttle > 0 and c.brake == 0 and c.steer == pytest.approx(-0.1)
    assert ackermann_to_control(0.0, 0.0, EGO).brake > 0
    assert twist_to_control(5.0, 0.0, EGO).steer == 0.0


def test_mission_success_and_stopping_scores_low():
    ok = mission_metrics(rows([8.0] * 20), M)
    assert ok["mission_success"] and ok["driving_score"] == 100.0 and ok["goal_reached_t_s"] == 7.0
    stop = mission_metrics(rows([8.0] * 4 + [0.0] * 16), M)  # "survives" by stopping
    assert not stop["mission_success"] and stop["route_completion_pct"] == pytest.approx(24.0)
    assert stop["infractions"]["blocked_at_t_s"] == 6.5


def test_mission_penalties():
    col = mission_metrics(rows([8.0] * 20, collision_at=5), M)
    assert not col["mission_success"] and col["driving_score"] == pytest.approx(60.0)
    out = mission_metrics(rows([8.0] * 20, lat=-2.5), M)  # drove the whole way outside the allowed lanes
    assert out["driving_score"] == 0.0
    fast = mission_metrics(rows([10.0] * 20), M)
    assert len(fast["infractions"]["speeding_events"]) == 1 and fast["driving_score"] == pytest.approx(90.0)
    assert mission_metrics(rows([8.0] * 20), M) == mission_metrics(rows([8.0] * 20), M)  # deterministic


def test_sensor_checks():
    good = [SensorSpec("L", "lidar", x=1.5, z=1.9), SensorSpec("G", "gnss", rate_hz=10)]
    assert all(r[0] != "fail" for r in check_sensors(good))  # no live blueprints: only "skipped" warnings
    bad = check_sensors([SensorSpec("O", "objects"), SensorSpec("L", "lidar", z=3.5), SensorSpec("C", "camera", rate_hz=7)]
                        + [SensorSpec(f"x{i}", "lidar") for i in range(2)])
    text = " ".join(r[2] for r in bad)
    assert "privileged" in text and "3.0 m" in text and "jitter" in text and "limit 2" in text


def test_digest_matches_hedera_for_one_file_and_sha256sum_for_many(tmp_path):
    (tmp_path / "a.py").write_text("a")
    (tmp_path / "b.py").write_text("b")
    ha, hb = (hashlib.sha256(x).hexdigest() for x in (b"a", b"b"))
    assert digest(["a.py"], tmp_path) == "0x" + ha
    assert digest(["b.py", "a.py"], tmp_path) == "0x" + hashlib.sha256(f"{ha}  a.py\n{hb}  b.py\n".encode()).hexdigest()


def test_reference_stacks_dry_run_deterministic_and_react():
    for spec in ("stacks/pdm_lite.yaml", "stacks/idm_lidar.yaml"):
        _, factory = resolve(spec)
        assert isinstance(factory(), AVStack)
        a, _ = dry_run(factory, 40)
        b, _ = dry_run(factory, 40)
        assert a == b and all(not c.problems() for c in a) and any(c.brake > 0 for c in a)


class FakeLbAgent:
    def __init__(self, host, port, debug):
        self.calls = []

    def setup(self, conf):
        self.calls.append(("setup", conf))

    def sensors(self):
        return [{"type": "sensor.lidar.ray_cast", "id": "LIDAR", "x": 1.3, "y": 0, "z": 2.5, "roll": 0, "pitch": 0,
                 "yaw": -90, "channels": 32}, {"type": "sensor.speedometer", "id": "SPEED", "reading_frequency": 20}]

    def set_global_plan(self, gps, world):
        self.calls.append(("plan", len(gps), len(world)))

    def run_step(self, input_data, timestamp):
        self.calls.append(("step", sorted(input_data), timestamp))
        return types.SimpleNamespace(throttle=0.3, brake=0.0, steer=0.1)

    def destroy(self):
        self.calls.append(("destroy",))


def test_leaderboard_adapter():
    st = LeaderboardAgentStack(FakeLbAgent, "conf.yaml")
    ss = st.sensors()
    assert [s.type for s in ss] == ["lidar", "odometry"] and ss[0].params == {"channels": "32"} and ss[0].yaw == -90
    st.setup(M, "map.osm")
    c = st.run_step({"LIDAR": (1, np.zeros((0, 4))), "SPEED": (1, {"speed": 3.0})}, EGO, 0.05)
    st.destroy()
    assert c == Control(0.3, 0.0, 0.1)
    assert st.agent.calls[0] == ("setup", "conf.yaml") and st.agent.calls[1] == ("plan", 0, 100)
    with pytest.raises(UnsupportedSensor):
        from_leaderboard_sensor({"type": "sensor.other.radar", "id": "R"})


def test_ros_adapter_timeout_brakes_and_counts():
    st = RosStack([SensorSpec("L", "lidar")], latency_budget_s=0.05)
    t = [0.0]
    st.rclpy, st.node = types.SimpleNamespace(spin_once=lambda n, timeout_sec: t.__setitem__(0, t[0] + 0.02)), object()
    assert st.wait_control(EGO, clock=lambda: t[0]) == Control(brake=1.0) and st.timeouts == 1
    st._last = types.SimpleNamespace(drive=types.SimpleNamespace(speed=5.0, steering_angle=0.0, acceleration=0.0))
    assert st.wait_control(EGO, clock=lambda: t[0]) == Control(0.0, 0.0, 0.0) and st.timeouts == 1


def test_sites_catalogue_and_seeded_selection():
    cat = sites.load()
    ok = [s for s in cat if "cut_in" in s["families"]]
    assert len(ok) >= 3 and all(s["straight_m"] >= sites.MIN_LEN_M["cut_in"] and not s["obstacles"] for s in ok)
    assert sites.select(0) == sites.select(len(ok)) and sites.select(0) != sites.select(1)
    dup = [dict(ok[0], id="a", straight_m=80.0), dict(ok[0], id="b", straight_m=90.0)]
    assert [s["id"] for s in sites.dedupe(dup)] == ["b"]


def test_script_decider(tmp_path):
    p = tmp_path / "d.jsonl"
    p.write_text("\n".join(json.dumps(e) for e in [{"source": "0g", "action": "CUT_IN"}, {"source": "none", "action": None},
                                                    {"source": "0g", "action": "BRAKE_HARD"}]))
    d = ScriptDecider(p)
    acts = [d.decide({}, {}, avail).action for avail in (("CUT_IN", "KEEP_LANE"), ("KEEP_LANE",), ("KEEP_LANE",))]
    assert acts == ["CUT_IN", "KEEP_LANE", "KEEP_LANE"]  # unavailable -> KEEP_LANE, then script exhausted
    assert d.source == "replayed"


def test_synthetic_inputs_are_seeded():
    s = [SensorSpec("L", "lidar", x=1.5, z=1.9)]
    a, b = synthetic(s, 3)[1], synthetic(s, 3)[1]
    assert all((x[0]["L"][1] == y[0]["L"][1]).all() for x, y in zip(a, b))
