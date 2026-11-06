"""Performance ledger: rows from a real (kinematic, fake-Router) swarm run; append / replace; markdown summary."""
import json

from faultline import ledger, swarm
from tests.python.test_swarm import _Http


def test_ledger_rows_and_markdown(tmp_path, monkeypatch):
    runs = tmp_path / "runs"
    monkeypatch.setattr(ledger, "ROOT", tmp_path)
    monkeypatch.setattr(ledger, "CSV", runs / "ledger.csv")
    monkeypatch.setattr(ledger, "MD", tmp_path / "ledger.md")
    out = runs / "swarm-x"
    swarm.run_swarm_episode(swarm.KinematicSwarmWorld(), swarm.JointRouter("http://x", "k", http=_Http([])),
                            swarm.SwarmScenario(seed=0), out)  # the runner records itself
    rows = ledger.load()
    r = rows["swarm-x"]
    assert r["family"] == "swarm" and r["backfilled"] == "0" and r["ccs_source"] == "ground_truth"
    assert r["decisions_0g"] == "10" and float(r["parse_rate"]) == 1.0 and r["tet_s"] != ""
    assert r["cost_usd"] == ""  # the fake Router reports no usage: blank, never invented
    assert ledger.record(out, backfilled=True)["backfilled"] == "0" and ledger.load()["swarm-x"]["backfilled"] == "0"
    assert ledger.record(tmp_path / "elsewhere") is None  # outside runs/: ignored
    md = (tmp_path / "ledger.md").read_text()
    assert "| swarm | 1 |" in md and "swarm-x" in md
    m = json.loads((out / "metrics.json").read_text())
    assert m["extended"]["decisions"] == 10 and "ground_truth" in m  # existing keys kept
