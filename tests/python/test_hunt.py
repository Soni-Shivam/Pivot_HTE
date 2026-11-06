"""Failure hunter: experiment runner, ground truth, classical designers, 0G designer (fake Router), minimizer."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from faultline import hunt
from faultline.designer import Designer, parse_turn
from faultline.experiment import SPACE, run_experiment, validate
from faultline.log import ChainLog, verify_chain

P = {"ego_speed_mps": 15.0, "initial_gap_m": 30.0, "lead_decel_mps2": 6.0, "friction_mu": 0.8, "reaction_delay_s": 0.9,
     "brake_onset_s": 5.0}


def test_experiment_is_deterministic_and_fast():
    import time
    t = time.monotonic()
    a, b = run_experiment(P), run_experiment(dict(P))
    assert (time.monotonic() - t) / 2 < 0.2
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    assert set(a) >= {"collision", "min_gap_m", "min_ttc_s", "max_drac_mps2", "ccs", "ego_max_decel_mps2",
                      "measured_reaction_s", "safe"}
    assert a["safe"] == (not a["collision"] and a["min_gap_m"] >= 2.0)


def test_clamp_is_reported():
    o = run_experiment({**P, "friction_mu": 0.3, "lead_decel_mps2": 9.0})
    assert o["lead_decel_clamped"] and o["lead_decel_applied_mps2"] == pytest.approx(0.8 * 9.81 * 0.3, abs=1e-3)


def test_validity_rejection():
    assert validate(P) is None
    assert "outside" in validate({**P, "initial_gap_m": 81})
    assert "missing" in validate({k: v for k, v in P.items() if k != "friction_mu"})
    assert "extra" in validate({**P, "x": 1})
    assert "not a number" in validate({**P, "friction_mu": "0.8"})
    assert "not a number" in validate({**P, "friction_mu": True})
    assert validate([1, 2]) == "not_an_object"
    e = hunt.execute(hunt.G1, {**P, "ego_speed_mps": 20.0})
    assert e["status"] == "off_goal" and e["outcome"] is None


def test_ground_truth_boundary_is_monotone_on_a_tiny_sweep():
    rows = [hunt.boundary_at(hunt.G1, d, res=1.0, scan_step=5.0) for d in (0.3, 0.9, 1.5)]
    assert all(r["monotone"] for r in rows)
    gaps = [r["estimate_m"] for r in rows]
    assert gaps == sorted(gaps) and gaps[0] < gaps[-1]
    r = rows[1]
    assert run_experiment(hunt._point(hunt.G1, r["min_safe_gap_m"], 0.9))["safe"]
    assert not run_experiment(hunt._point(hunt.G1, r["min_safe_gap_m"] - 1.0, 0.9))["safe"]


@pytest.mark.parametrize("make", [hunt.grid, lambda g: hunt.random_sampler(g, 3), hunt.bisection])
def test_classical_methods_respect_the_budget(make):
    r = hunt.run_method("m", hunt.G1, make(hunt.G1), budget=7)
    assert len(r["experiments"]) == 7 and all(e["status"] == "ran" for e in r["experiments"])
    assert r["inference_calls"] == 0 and r["estimate"]


def test_bisection_brackets_converge():
    r = hunt.run_method("C", hunt.G1, hunt.bisection(hunt.G1, delays=(0.9,)), budget=8)
    est = r["estimate"][0]["min_safe_gap_m"]
    assert abs(est - hunt.boundary_at(hunt.G1, 0.9, scan_step=75)["estimate_m"]) < 75 / 2 ** 8 + 0.3


# ---------------------------------------------------------------- 0G designer against a fake Router
MODE, SEEN = ["ok"], []
GOOD = {"hypothesis": "h", "experiment": dict(P), "why": "w"}
FINAL = {"boundary": [{"reaction_delay_s": 0.9, "min_safe_gap_m": 50.0}], "findings": ["f"], "uncertainty": [],
         "next_tests": []}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append((body["model"], self.headers.get("X-0G-Provider-Trust-Mode"), body["temperature"],
                     body["response_format"]["type"]))
        final = "budget is used up" in body["messages"][0]["content"]
        n = len(SEEN)
        if MODE[0] == "r502" and n == 2:
            raw, status = b'{"error":{"code":"bad_gateway"}}', 502
        else:
            content = {"ok": GOOD, "prose": None, "oob": {**GOOD, "experiment": {**P, "initial_gap_m": 500}}}[MODE[0] if MODE[0] != "r502" else "ok"]
            content = json.dumps(FINAL if final else content) if content is not None else "Sure! " + json.dumps(GOOD)
            raw, status = json.dumps({"choices": [{"message": {"content": content}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                                      "x_0g_trace": {"request_id": f"r{n}", "provider": "0xp"}}).encode(), 200
        self.send_response(status)
        self.send_header("Zg-Res-Key", f"k{n}")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


@pytest.fixture(scope="module")
def url():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/v1"
    srv.shutdown()


def go(url, mode, tmp_path, budget=3):
    MODE[0] = mode
    SEEN.clear()
    log = ChainLog(tmp_path / "designer.jsonl")
    r = hunt.run_designer(hunt.G1, Designer(url, "sk-test"), log, budget=budget)
    assert verify_chain(tmp_path / "designer.jsonl", log.head)
    assert SEEN and all(s == ("0gm-1.0-35b-a3b", "private", 0, "json_object") for s in SEEN)
    return r, [json.loads(l) for l in (tmp_path / "designer.jsonl").read_text().splitlines()]


def test_designer_good_turns_and_final(url, tmp_path):
    r, lines = go(url, "ok", tmp_path)
    assert r["status"] == "completed" and len(r["experiments"]) == 3 and r["inference_calls"] == 4
    assert r["estimate"] == FINAL["boundary"] and r["tokens"] == {"prompt_tokens": 40, "completion_tokens": 20}
    assert [l["request_id"] for l in lines] == ["r1", "r2", "r3", "r4"] and lines[0]["zg_res_key"] == "k1"
    assert lines[0]["validity"] == "ran" and lines[0]["outcome"]["safe"] is False and lines[-1]["kind"] == "final"


def test_designer_prose_halts(url, tmp_path):
    r, lines = go(url, "prose", tmp_path)
    assert r["status"] == "halted" and "invalid_json" in r["reason"] and not r["experiments"] and len(SEEN) == 1
    assert r["estimate"] is None and lines[0]["parse"] == "invalid_json"


def test_designer_out_of_range_is_invalid_but_continues(url, tmp_path):
    r, lines = go(url, "oob", tmp_path)
    assert r["status"] == "completed" and [e["status"] for e in r["experiments"]] == ["invalid"] * 3
    assert "outside" in lines[0]["invalid_reason"] and lines[0]["outcome"] is None


def test_designer_502_halts_without_fallback(url, tmp_path):
    r, lines = go(url, "r502", tmp_path)
    assert r["status"] == "halted" and "http_502" in r["reason"] and len(r["experiments"]) == 1 and len(SEEN) == 2


def test_parse_turn_strict():
    assert parse_turn(json.dumps(GOOD))[1] == "ok"
    assert parse_turn("<think>x</think>" + json.dumps(GOOD))[1] == "ok"
    assert parse_turn(json.dumps({**GOOD, "extra": 1}))[1] == "bad_schema"
    assert parse_turn(json.dumps(GOOD) + json.dumps(GOOD))[1] == "invalid_json"


# ---------------------------------------------------------------- minimizer
def test_minimizer_finds_the_necessary_factors():
    rule = lambda q: {"safe": not (q["friction_mu"] < 0.5 and q["initial_gap_m"] < 30), "min_gap_m": 0.0}
    start = {"friction_mu": 0.3, "reaction_delay_s": 1.4, "lead_decel_mps2": 8.0, "initial_gap_m": 10.0,
             "ego_speed_mps": 28.0, "brake_onset_s": 4.0}
    m = hunt.minimize(start, run=rule)
    assert {n["factor"] for n in m["necessary"]} == {"friction_mu", "initial_gap_m"}
    assert all(n["counterfactual_safe"] for n in m["necessary"])
    assert set(m["restored"]) == {"reaction_delay_s", "lead_decel_mps2", "ego_speed_mps"}
    assert m["minimal_failing_case"]["friction_mu"] > 0.45 and m["minimal_failing_case"]["initial_gap_m"] > 27


def test_svg_renders():
    r = hunt.run_method("A", hunt.G1, hunt.grid(hunt.G1), budget=4)
    s = hunt.svg(hunt.G1, None, r, "t")
    assert s.startswith("<svg") and s.count("<circle") == 4
