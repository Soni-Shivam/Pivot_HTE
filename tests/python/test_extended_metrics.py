"""faultline.metrics.extended on constructed trajectories (dt 0.1 s)."""
import base64
import json

import pytest

from faultline.metrics.extended import extended_metrics

SC = {"dt_s": 0.1, "lane_width_m": 3.5, "ego_speed_mps": 10.0}


def row(t, ego_x, ego_v, ego_a=0.0, cars=None, brake=0.0, guarded=()):
    """Swarm-shaped row; the nearest in-path car ahead (if any) fills the gt_* fields."""
    cars = cars or {}
    ahead = [(c["arc"], c) for c in cars.values() if c["in_path"] and c["arc"] > ego_x]
    gap = ttc = None
    if ahead:
        arc, c = min(ahead, key=lambda x: x[0])
        gap = arc - 4.7 / 2 - (ego_x + 4.9 / 2)
        ttc = gap / (ego_v - c["v"]) if gap > 0 and ego_v - c["v"] > 1e-3 else None
    return {"t_s": t, "ego_x": ego_x, "ego_v": ego_v, "ego_a": ego_a, "lead_x": 0.0, "lead_v": 0.0,
            "gt_gap": gap if gap is not None else 99.0, "gt_in_path": gap is not None, "gt_ttc_s": ttc,
            "ego_brake": brake, "cars": cars, "guarded": list(guarded)}


def car(arc, lat, v):
    return {"arc": arc, "lat": lat, "v": v, "in_path": abs(lat) < 2.0}


def test_tet_tit_thw_from_ttc_series():
    # car ahead at 5 m/s, ego 10 m/s: gap shrinks 0.5 m per tick from 10 m -> TTC 2.0, 1.9, ...
    rows = [row(0.1 * i, 0.0, 10.0, cars={"A": car(4.8 + 10.0 - 0.5 * i, 0.0, 5.0)}) for i in range(10)]
    m = extended_metrics(rows, [], SC)
    # TTC < 1.5 at gaps 7.0 .. 5.5 (i = 6..9): 4 ticks -> TET 0.4 s; TIT = 0.1 * (0.1+0.2+0.3+0.4)
    assert m["tet_s"] == pytest.approx(0.4) and m["tit_s2"] == pytest.approx(0.1)
    assert m["min_thw_s"] == pytest.approx(0.55)  # 5.5 m / 10 m/s
    assert m["threat_onset_t_s"] == pytest.approx(0.0) and m["critical_t_s"] == pytest.approx(0.9)


def test_jerk_comfort_and_brake_reaction():
    # threat from t=0.3 (TTC < 3 s), ego starts braking (brake 0.5) at t=0.8 -> reaction 0.5 s
    rows = []
    for i in range(30):
        t = 0.1 * i
        rows.append(row(t, 0.0, 10.0, ego_a=-4.0 if t >= 0.8 else 0.0, brake=0.5 if t >= 0.8 else 0.0,
                        cars={"A": car(4.8 + (40.0 if t < 0.3 else 20.0), 0.0, 2.0)}))
    m = extended_metrics(rows, [], SC)
    assert m["brake_reaction_s"] == pytest.approx(0.5)
    assert m["ego_max_jerk_mps3"] == pytest.approx(8.0)  # a 4 m/s² step over the 5-tick (0.5 s) average
    assert 0.0 < m["comfort_index"] < 1.0
    calm = extended_metrics([row(0.1 * i, i * 1.0, 10.0) for i in range(30)], [], SC)
    assert calm["comfort_index"] == 1.0 and calm["ego_max_jerk_mps3"] == 0.0 and calm["brake_reaction_s"] is None


def test_pet_escape_space_efficiency_activity_guard():
    rows = []
    for i in range(40):
        t, ex = 0.1 * i, 8.0 * 0.1 * i
        lat = 3.5 if i < 10 else (1.0 if i < 12 else 0.0)  # B cuts in at tick 10, rear 10 m ahead of the ego front
        b = car(ex + 4.9 / 2 + 10.0 + 4.7 / 2, lat, 4.0 if i > 20 else 8.0)  # brakes from tick 21
        c = car(ex + 30.0, 3.5, 8.0)  # left lane, far ahead
        rows.append(row(t, ex, 8.0, cars={"B": b, "C": c}, guarded=("B",) if i == 5 else ()))
    m = extended_metrics(rows, [], SC)
    assert m["encroachments"] == 1 and m["pet_s"] == pytest.approx(1.3)  # ego front covers 10 m at 8 m/s: 1.25 s -> tick
    assert m["adversary_activity"]["B"] == {"lane_changes": 1, "brake_events": 1}
    assert m["adversary_activity"]["C"] == {"lane_changes": 0, "brake_events": 0}
    assert m["ego_efficiency"] == pytest.approx(0.8) and m["guard_ticks"] == 1
    # at the critical moment C is the only left-lane car: free ahead = 30 - 4.7/2 - 4.9/2, behind capped at 50 m
    assert m["escape_space_m"] == pytest.approx(30.0 - 2.35 - 2.45 + 4.9 + 50.0, abs=1e-3)
    rows2 = [dict(r, cars={**r["cars"], "C": car(r["ego_x"], 3.5, 8.0)}) for r in rows]  # C beside the ego
    assert extended_metrics(rows2, [], SC)["escape_space_m"] == 0.0


def test_lead_brake_rows_and_call_stats():
    rows = [{"t_s": 0.1 * i, "ego_x": 0.0, "ego_v": 10.0, "ego_a": 0.0, "lead_x": 20.0, "lead_v": 10.0 - i,
             "lead_a": -10.0 if i else 0.0, "gt_gap": 3.0} for i in range(5)]
    body = {"usage": {"prompt_tokens": 100, "completion_tokens": 10}, "x_0g_trace": {"billing": {}}}
    dec = [{"source": "0g", "content": "{}", "request_id": "r1", "latency_ms": 1000,
            "raw_b64": base64.b64encode(json.dumps(body).encode()).decode()},  # old run: usage only in the raw body
           {"source": "none", "content": "x", "request_id": "r2", "latency_ms": 3000,
            "usage": {"prompt_tokens": 50, "completion_tokens": 5}, "cost_usd": 1e-5},
           {"source": "none", "content": None, "request_id": None, "latency_ms": 20000}]  # timeout
    m = extended_metrics(rows, dec, {"dt_s": 0.1, "ego_speed_mps": 20.0},
                         plan={"request_id": "p", "latency_ms": 30000, "usage": None, "cost_usd": None})
    assert m["escape_space_m"] is None and m["pet_s"] is None and m["adversary_activity"]["lead"]["brake_events"] == 1
    assert m["ego_efficiency"] == 0.5 and m["tet_s"] == pytest.approx(0.2)  # TTC 3/i: i = 3, 4
    assert m["parse_rate"] == 0.5 and m["calls"] == 4 and m["calls_with_usage"] == 2
    assert m["latency_mean_ms"] == 8000.0 and m["plan_latency_ms"] == 30000
    assert m["prompt_tokens"] == 150 and m["completion_tokens"] == 15
    assert m["cost_usd"] == pytest.approx(100 * 0.08e-6 + 10 * 0.48e-6 + 1e-5)
