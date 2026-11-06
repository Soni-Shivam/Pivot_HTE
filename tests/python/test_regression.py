"""Regression campaign (no network): classifier, strict parsers, report audit, and the full campaign against a fake
Router (private tier, temperature 0, JSON mode, hash-chained log)."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from faultline import memory as M, regression as G, research as R
from faultline.designer import Designer
from faultline.log import verify_chain

P = {"ego_speed_mps": 15.0, "initial_gap_m": 30.0, "lead_decel_mps2": 6.0, "friction_mu": 0.8, "reaction_delay_s": 0.6,
     "brake_onset_s": 5.0}


def rec(i, v, p, safe, fp=None, coll=False, speed=10.0):
    return {"i": i, "model": {"model_id": "idm-follower", "version": v}, "category": M.category(p), "params": p,
            "outcome": {"safe": safe, "collision": coll, "min_gap_m": 3.0 if safe else 0.5, "mean_speed_mps": speed,
                        "cruise_thw_s": 2.0}, "fingerprint": fp}


def test_classify_statuses():
    a, b, c = P, {**P, "initial_gap_m": 20.0}, {**P, "lead_decel_mps2": 3.0}
    recs = [rec(0, "1.0", a, False, "F1", True), rec(1, "1.1", a, True),             # F1 fixed
            rec(2, "1.0", b, False, "F2"), rec(3, "1.1", b, False, "F2"),            # F2 persists
            rec(4, "1.0", c, True), rec(5, "1.1", c, False, "F3", speed=8.0)]        # new weakness, lead_brake regressed
    cls = G.classify(recs)
    st = {f["fingerprint"]: f["status"] for f in cls["fingerprints"]}
    assert st == {"F1": "fixed", "F2": "persists", "F3": "new_weakness"}
    cats = {x["category"]: x for x in cls["categories"]}
    assert cats["hard_brake"]["status"] == "improved" and cats["hard_brake"]["cases_fixed"] == 1
    assert cats["lead_brake"]["status"] == "regressed" and cats["lead_brake"]["regressions"] == [5]
    assert cats["hard_brake"]["collision"]["1.0"]["rate"] == 0.5 and cats["hard_brake"]["collision"]["1.1"]["rate"] == 0.0
    assert G.classify(recs, known={"F3"})["fingerprints"][-1]["fingerprint"] == "F2"  # known keys are not new
    assert G.changed_examples(recs)[0]["params"] == c  # the regression is listed first


def test_parsers_strict():
    ok = json.dumps({"experiments": [{"params": P, "hypothesis": "h"}], "why": "w"})
    assert G.parse_plan(ok, 6)[1] == "ok"
    assert G.parse_plan(ok, 0)[1] == "bad_schema"
    assert G.parse_plan("nope", 6)[1] == "invalid_json"
    assert G.parse_plan(json.dumps({"experiments": [], "why": "w", "x": 1}), 6)[1] == "bad_schema"
    assert G.parse_report(json.dumps({"summary": "s", "claims": [], "caveats": ["c"]}))[1] == "ok"
    assert G.parse_report(json.dumps({"summary": "s", "claims": []}))[1] == "bad_schema"


def test_audit_report():
    a, b = P, {**P, "initial_gap_m": 20.0}
    cls = G.classify([rec(0, "1.0", a, False, "F1", True), rec(1, "1.1", a, True), rec(2, "1.0", b, False, "F2"),
                      rec(3, "1.1", b, False, "F2")])
    rep = {"claims": [{"text": "t", "kind": "rate", "version": "1.0", "category": "hard_brake", "metric": "collision_rate", "value": 0.5},
                      {"text": "t", "kind": "rate", "version": "1.1", "category": "hard_brake", "metric": "unsafe_rate", "value": 0.0},
                      {"text": "t", "kind": "fingerprint", "fingerprint": "F1", "status": "fixed"},
                      {"text": "t", "kind": "fingerprint", "fingerprint": "F2", "status": "fixed"},
                      {"text": "t", "kind": "category", "category": "hard_brake", "status": "improved"},
                      {"text": "t", "kind": "vibes"}]}
    au = G.audit_report(rep, cls)
    assert [r["verdict"] for r in au["claims"]] == ["supported", "contradicted", "supported", "contradicted", "supported", "malformed"]


PLAN = {"experiments": [{"params": {**P, "reaction_delay_s": 1.3, "initial_gap_m": 40.0}, "hypothesis": "slow reaction"},
                        {"params": {**P, "friction_mu": 2.0}, "hypothesis": "bad"}], "why": "probe"}
REPORT = {"summary": "v1.1 fixes most", "claims": [{"text": "x", "kind": "category", "category": "hard_brake", "status": "improved"}],
          "caveats": ["one world"]}
SEEN = []


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append((body["model"], self.headers.get("X-0G-Provider-Trust-Mode"), body["temperature"], body["response_format"]["type"]))
        content = json.dumps(REPORT if "regression report" in body["messages"][0]["content"] else PLAN)
        raw = json.dumps({"choices": [{"message": {"content": content}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                          "x_0g_trace": {"request_id": f"r{len(SEEN)}", "provider": "0xp"}}).encode()
        self.send_response(200)
        self.send_header("Zg-Res-Key", f"k{len(SEEN)}")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


@pytest.fixture
def url():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/v1"
    srv.shutdown()


def test_campaign_end_to_end(tmp_path, url, monkeypatch):
    lib = tmp_path / "lib.jsonl"
    lib.write_text("\n".join(l for l in R.LIB_PATH.read_text().splitlines()[:4]) + "\n")
    monkeypatch.setattr(G, "_live", lambda m: None)
    monkeypatch.setattr(R, "_designer", lambda: Designer(url, "sk-test"))
    refs, mem = M.models(), M.Memory(tmp_path / "records.jsonl")
    st = G.seed(tmp_path, mem, refs["1.0"], lib_path=lib, mission=tmp_path / "none.json")
    assert st["imported"] == 4 and st["stored_outcome_mismatch"] == 0 and st["suite"] == 40 and st["probes"] > 0
    M.write_snapshot(tmp_path, mem, refs["1.0"], 1, None, [])
    (tmp_path / "snap-1" / "publish.json").write_text(json.dumps({"sealedRoot": "0x" + "cd" * 32}))
    SEEN.clear()
    assert G.main(["campaign", "--out", str(tmp_path), "--extra", "2"]) == 0
    d = json.loads((tmp_path / "regression.json").read_text())
    assert [e["status"] for e in d["extra"]] == ["ran", "invalid"] and d["chain_ok"]
    assert SEEN and all(s == ("0gm-1.0-35b-a3b", "private", 0, "json_object") for s in SEEN)
    assert d["audit"]["counts"]["supported"] == 1 and d["stats"]["request_ids"] == ["r1", "r2"]
    recs = mem.records()
    n10 = sum(r["model"]["version"] == "1.0" for r in recs)
    assert n10 == sum(r["model"]["version"] == "1.1" for r in recs) == d["final"]["pairs"]
    zg = [r for r in recs if r["chosen_by"] == "0g"]
    assert len(zg) == 2 and all(r["request_id"] == "r1" for r in zg)
    pub = json.loads((tmp_path / "snap-2" / "public.json").read_text())
    assert pub["prev_snapshot_root"] == "0x" + "cd" * 32 and pub["seq"] == 2 and pub["request_ids"] == ["r1", "r2"]
    assert verify_chain(tmp_path / "designer.jsonl", d["log_head"])
