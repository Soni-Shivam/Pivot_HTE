"""Research loop (no network): tools on budget, fingerprints, J(s), counterfactuals, audit, fix rule, config hash,
hybrid designer against a fake Router."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from faultline import hunt, research as R
from faultline.designer import Designer
from faultline.experiment import run_experiment
from faultline.log import ChainLog, verify_chain

P = {"ego_speed_mps": 15.0, "initial_gap_m": 30.0, "lead_decel_mps2": 6.0, "friction_mu": 0.8, "reaction_delay_s": 0.9,
     "brake_onset_s": 5.0}
CRASH = {"ego_speed_mps": 25.0, "initial_gap_m": 20.0, "lead_decel_mps2": 8.0, "friction_mu": 0.8, "reaction_delay_s": 1.0,
         "brake_onset_s": 5.0}
MISSION = {"id": "m", "text": "t", "fixed": {}, "ranges": dict(R.SPACE)}


def lab(goal=hunt.G1, budget=10):
    return R.Lab(goal, budget)


def test_bisect_respects_budget_and_converges():
    L = lab(budget=6)
    t = R.execute_tool(L, 1, "bisect", {"param": "initial_gap_m", "lo": 5, "hi": 80, "safe_side": "hi", "steps": 8,
                                         "fixed": {"reaction_delay_s": 0.9}})
    assert t["status"] == "ok" and len(L.hist) == 6 and L.remaining == 0
    r = t["result"]
    assert r["unsafe_end"] < r["safe_end"] and r["safe_end"] - r["unsafe_end"] <= 75 / 2 ** 6 + 1e-3
    gt = hunt.boundary_at(hunt.G1, 0.9, scan_step=75)["estimate_m"]
    assert abs(r["boundary_estimate"] - gt) < 75 / 2 ** 6 + 0.3


def test_bisect_reuses_measured_bracket():
    L = lab(budget=20)
    args = {"param": "initial_gap_m", "lo": 5, "hi": 80, "safe_side": "hi", "steps": 3, "fixed": {"reaction_delay_s": 0.9}}
    a = R.execute_tool(L, 1, "bisect", args)["result"]
    b = R.execute_tool(L, 2, "bisect", args)["result"]
    assert b["safe_end"] - b["unsafe_end"] == pytest.approx((a["safe_end"] - a["unsafe_end"]) / 8, abs=1e-3)


def test_sweep_grid_probe_and_invalid_calls():
    L = lab(budget=14)
    t = R.execute_tool(L, 1, "sweep_delay", {"delays": [0.3, 0.9, 1.5], "gap_range": [5, 80], "steps_per_delay": 2})
    assert t["status"] == "ok" and len(L.hist) == 6 and set(t["result"]["per_delay"]) == {"0.3", "0.9", "1.5"}
    assert R.execute_tool(L, 2, "grid", {"param": "initial_gap_m", "values": [20, 60]})["experiments"] == [7, 8]
    assert R.execute_tool(L, 3, "probe", {"experiment": {"initial_gap_m": 40, "reaction_delay_s": 0.5}})["status"] == "ok"
    bad = R.execute_tool(L, 4, "teleport", {})
    assert bad["status"] == "invalid" and L.hist[-1]["status"] == "invalid" and L.hist[-1]["J"] == -R.DELTA
    off = R.execute_tool(L, 5, "probe", {"experiment": {"ego_speed_mps": 25}})  # G1 fixes speed: off-goal, charged
    assert L.hist[-1]["status"] == "invalid" and "fixes" in L.hist[-1]["reason"] and off["J"] == -1.0
    assert R.execute_tool(L, 6, "bisect", {"param": "ego_speed_mps", "lo": 8, "hi": 20})["status"] == "invalid"
    assert len(L.hist) == 12


def test_minimize_keeps_collision_and_counterfactual_delta():
    L = R.Lab(MISSION, 60)
    R.execute_tool(L, 1, "probe", {"experiment": CRASH})
    assert L.hist[0]["outcome"]["collision"]
    m = R.execute_tool(L, 2, "minimize", {"case_id": 1})["result"]
    assert m["status"] == "done" and m["predicate"] == "still collides"
    assert L.get(m["minimal_case_id"])["outcome"]["collision"] and m["necessary"]
    assert all(L.get(n["run"]) and not L.get(n["run"])["outcome"]["collision"] for n in m["necessary"])
    c = R.execute_tool(L, 3, "counterfactual", {"case_id": 1, "change": {"initial_gap_m": 40}})["result"]
    new = run_experiment({**CRASH, "initial_gap_m": 60.0})
    assert c["delta_min_gap_m"] == pytest.approx(new["min_gap_m"] - L.hist[0]["outcome"]["min_gap_m"], abs=1e-3)
    assert c["collision_flipped"] == (not new["collision"])


def test_minimize_partial_when_budget_runs_out():
    L = R.Lab(MISSION, 4)
    R.execute_tool(L, 1, "probe", {"experiment": CRASH})
    m = R.execute_tool(L, 2, "minimize", {"case_id": 1})["result"]
    assert m["status"] == "budget_exhausted" and L.remaining == 0 and L.get(m["minimal_case_id"])["outcome"]["collision"]


def _trace(gaps, ttcs, ego_v=None, lead_v=None, collision=False, clamped=False, decel=3.0, reaction=0.5):
    rows = [{"t": round(0.05 * (i + 1), 6), "lidar_gap": g, "ttc_s": c, "ego_v": (ego_v or [10] * len(gaps))[i],
             "lead_v": (lead_v or [10] * len(gaps))[i], "ego_a": 0} for i, (g, c) in enumerate(zip(gaps, ttcs))]
    return {"safe": False, "collision": collision, "rows": rows, "onset_t_s": 0.05, "min_gap_m": min(gaps),
            "gap_at_onset_m": gaps[0], "measured_reaction_s": reaction, "lead_decel_clamped": clamped, "ego_max_decel_mps2": decel}


def test_fingerprint_classifier_on_constructed_trajectories():
    p = {**P, "friction_mu": 0.8, "reaction_delay_s": 0.1}
    # TTC collapses before the gap crosses 2 m, lead still moving, gap lost mostly after the reaction window
    f = R.fingerprint(p, _trace([20, 19, 15, 8, 1.0], [None, 9, 1.2, 1.0, 0.2], lead_v=[10, 9, 8, 7, 6], reaction=0.08))
    assert f["key"] == "margin/ttc_collapse/grip_available/braking_phase/during_lead_braking"
    # gap below margin first, lead already stopped, ego brakes at the friction limit, lost during the reaction window
    f = R.fingerprint(p, _trace([10, 4, 1.5, 1.4], [None, None, None, None], lead_v=[2, 0, 0, 0], decel=6.3, reaction=0.1,
                                collision=True))
    assert f["key"] == "collision/gap_below_margin/friction_limited/reaction_delay/after_lead_stopped"
    assert R.fingerprint(p, {"safe": True}) is None


def test_j_score_criticality_novelty():
    o = {"collision": False, "min_gap_m": 1.0}
    assert R.criticality(o) == 0.75 and R.criticality({"collision": True, "min_gap_m": 0}) == 1.0
    assert R.criticality({"collision": False, "min_gap_m": 9.0}) == 0.0
    fp = {"key": "k"}
    assert R.novelty(P, fp, [], set()) == 1.0
    prior = [{"status": "ran", "params": dict(P)}]
    assert R.novelty(P, fp, prior, {"k"}) == 0.0 and R.novelty(P, None, prior, set()) == 0.0
    assert 0 < R.novelty({**P, "initial_gap_m": 40.0}, None, prior, set()) < 1
    assert R.j_score(0.75, 0.5, False) == 1.25 and R.j_score(0, 0, True) == -1.0


def test_config_hash_is_stable_and_sensitive():
    h = R.config_hash(P)
    assert h == R.config_hash(dict(P)) and len(h) == 64
    assert h != R.config_hash({**P, "initial_gap_m": 30.5})
    assert h != R.config_hash(P, {"min_gap_m": 3.0})
    assert h != R.config_hash(P, None, "0gm-1.0-35b-a3b", "a" * 64)
    assert R.config_hash(P, {"min_gap_m": 2.0}) == h  # explicit default controller == default


def test_fix_acceptance_rule_blocks_on_regression():
    s = lambda safe: {"safe": safe}
    suite = [{"i": 0, "before": s(True), "after": s(True)}, {"i": 1, "before": s(False), "after": s(True)}]
    assert R.fix_verdict(s(False), s(True), suite) == ("improved", [])
    assert R.fix_verdict(s(False), s(False), suite) == ("no-change", [])
    reg = suite + [{"i": 2, "before": s(True), "after": s(False)}]
    assert R.fix_verdict(s(False), s(True), reg) == ("regressed", [2])  # the case is fixed, but the claim is blocked

    def fake(p, ctrl):  # a fix that saves the case and breaks suite scenario 3
        bad = ctrl and p.get("i") == 3
        return {"safe": bool(ctrl) and not bad if p.get("case") else not bad, "collision": False, "min_gap_m": 1.0,
                "mean_speed_mps": 10.0, "cruise_thw_s": 1.0}
    ev = R.evaluate_fix({**P, "case": 1}, {"min_gap_m": 3.0}, run=fake, suite=[{**P, "i": i} for i in range(5)])
    assert ev["verdict"] == "regressed" and ev["regressions"] == [3] and ev["failing_case"]["after"]["safe"]


def test_check_ctrl_bounds_and_real_fix_runs():
    assert R.check_ctrl({"min_gap_m": 9}) and R.check_ctrl({"x": 1}) and R.check_ctrl({}) and R.check_ctrl({"min_gap_m": 2.0})
    assert R.check_ctrl({"min_gap_m": 3.0}) is None
    ev = R.evaluate_fix(P, {"min_gap_m": 3.0}, suite=R.SUITE[:3])
    assert ev["verdict"] in ("improved", "regressed", "no-change") and len(ev["suite"]) == 3
    assert set(ev["efficiency"]) == {"mean_speed_mps", "cruise_thw_s"} and len(R.SUITE) >= 20


def test_audit_catches_the_old_designers_contradictions():
    # the old designer's G1 report: "1.5 s -> 61.0 m" while every tested gap at 1.5 s (up to 65 m) was unsafe, and it
    # called a safe experiment a collision
    pt = lambda g, d: hunt._point(hunt.G1, g, d)
    hist = []
    for g, d in ((29.0, 0.3), (29.4, 0.3), (60.0, 1.5), (65.0, 1.5), (80.0, 0.9)):
        hist.append({"n": len(hist) + 1, "status": "ran", "params": pt(g, d), "outcome": run_experiment(pt(g, d))})
    assert not hist[2]["outcome"]["safe"] and not hist[3]["outcome"]["safe"] and hist[4]["outcome"]["safe"]
    final = {"boundary": [{"reaction_delay_s": 1.5, "min_safe_gap_m": 61.0}, {"reaction_delay_s": 1.5, "min_safe_gap_m": None},
                          {"reaction_delay_s": 0.9, "min_safe_gap_m": 85.0}],
             "claims": [{"text": "experiment 5 collided", "type": "outcome", "runs": [5], "asserts": "collision"},
                        {"text": "more gap helps at 1.5 s", "type": "effect", "runs": [3, 4], "param": "initial_gap_m",
                         "change": "increase", "metric": "min_gap_m", "direction": "increase"},
                        {"text": "more gap hurts", "type": "effect", "runs": [3, 4], "param": "initial_gap_m",
                         "change": "increase", "metric": "min_gap_m", "direction": "decrease"},
                        {"text": "ghost", "type": "outcome", "runs": [99], "asserts": "safe"},
                        {"text": "vibes", "type": "general", "runs": [1]}, "not an object"]}
    a = R.audit(final, hist, hunt.G1, cf_runs=[4])
    v = [c["verdict"] for c in a["claims"]]
    assert v == ["contradicted", "supported", "contradicted", "contradicted", "unverifiable", "malformed"]
    assert [b["verdict"] for b in a["boundary"]] == ["contradicted", "supported", "extrapolated"]
    assert any("61.0" in f for f in a["flags"]) and not any("counterfactual" in f for f in a["flags"])
    assert any("counterfactual" in f for f in R.audit({"boundary": [], "claims": final["claims"][:1]}, hist, hunt.G1, [4])["flags"])


# ---------------------------------------------------------------- hybrid designer against a fake Router
MODE, SEEN = ["ok"], []
TOOL = {"hypothesis": "h", "tool": "sweep_delay", "args": {"delays": [0.3, 1.5], "gap_range": [5, 80], "steps_per_delay": 1}, "why": "w"}
FINAL = {"boundary": [{"reaction_delay_s": 0.3, "min_safe_gap_m": 42.5}], "claims": [{"text": "c", "type": "general", "runs": [1]}],
         "explanation": "e", "minimal_reproduction": "m", "uncertainty": [], "next_tests": []}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append((body["model"], self.headers.get("X-0G-Provider-Trust-Mode"), body["temperature"], body["response_format"]["type"]))
        final = "budget is used up" in body["messages"][0]["content"]
        turn = {"ok": TOOL, "menu": {**TOOL, "tool": "teleport"}, "stop": {**TOOL, "tool": "stop", "args": {}}}.get(MODE[0])
        content = json.dumps(FINAL) if final else (json.dumps(turn) if turn else "Sure! " + json.dumps(TOOL))
        raw = json.dumps({"choices": [{"message": {"content": content}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                          "x_0g_trace": {"request_id": f"r{len(SEEN)}", "provider": "0xp"}}).encode()
        self.send_response(200)
        self.send_header("Zg-Res-Key", f"k{len(SEEN)}")
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


def go(url, mode, tmp_path, budget=4):
    MODE[0] = mode
    SEEN.clear()
    log = ChainLog(tmp_path / "designer.jsonl")
    agent = R.Agent(Designer(url, "sk-test"), log, "g1")
    L = R.Lab(hunt.G1, budget, model=R.MODEL, prompt_sha=R.prompt_hashes()["turn"])
    res = R.run_hybrid(hunt.G1, agent, L, [])
    final = None
    if res["status"] == "completed":
        final, why = R.final_report(hunt.G1, agent, L, res["tool_log"], res["hypotheses"])
    assert verify_chain(tmp_path / "designer.jsonl", log.head)
    assert SEEN and all(s == ("0gm-1.0-35b-a3b", "private", 0, "json_object") for s in SEEN)
    return res, L, final, agent, [json.loads(l) for l in (tmp_path / "designer.jsonl").read_text().splitlines()]


def test_hybrid_good_tool_calls(url, tmp_path):
    res, L, final, agent, lines = go(url, "ok", tmp_path)
    assert res["status"] == "completed" and len(L.hist) == 4 and len(res["tool_log"]) == 2 and final == FINAL
    assert all(e["config_hash"] and e["tool"] == "sweep_delay" for e in L.hist)
    calls = [l for l in lines if l["kind"] in ("turn", "final")]
    assert [l["request_id"] for l in calls] == ["r1", "r2", "r3"] and calls[0]["zg_res_key"] == "k1" and calls[0]["provider"] == "0xp"
    assert any(l["kind"] == "tool_result" for l in lines)


def test_hybrid_bad_json_halts(url, tmp_path):
    res, L, final, agent, lines = go(url, "prose", tmp_path)
    assert res["status"] == "halted" and "invalid_json" in res["reason"] and not L.hist and len(SEEN) == 1


def test_hybrid_out_of_menu_is_invalid_but_continues(url, tmp_path):
    res, L, final, agent, lines = go(url, "menu", tmp_path, budget=3)
    assert res["status"] == "completed" and [e["status"] for e in L.hist] == ["invalid"] * 3 and len(SEEN) == 4
    assert "unknown tool" in L.hist[0]["reason"]


def test_hybrid_stop_ends_early(url, tmp_path):
    res, L, final, agent, lines = go(url, "stop", tmp_path)
    assert res["status"] == "completed" and not L.hist and len(SEEN) == 2


def test_parsers_strict():
    assert R.parse_tool(json.dumps(TOOL))[1] == "ok"
    assert R.parse_tool(json.dumps({**TOOL, "x": 1}))[1] == "bad_schema"
    assert R.parse_final(json.dumps(FINAL))[1] == "ok"
    assert R.parse_final(json.dumps({**FINAL, "explanation": 3}))[1] == "bad_schema"
    assert R.parse_fix(json.dumps({"hypothesis": "h", "ctrl": {"min_gap_m": 3}, "expected": "e"}))[1] == "ok"
    assert R.parse_fix("nope")[1] == "invalid_json"


def test_suite_has_at_least_20_cases_safe_with_the_current_controller():
    assert sum(run_experiment(p)["safe"] for p in R.SUITE) == 21 and len(R.SUITE) == 40
