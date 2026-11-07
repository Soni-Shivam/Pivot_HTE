"""Campaign with a fake Router: archive bookkeeping, planner sees the grid, page renders."""
import json

from faultline import campaign, swarm
from tests.python.test_swarm import _Http

PLAN = ('{"name":"Feint %d","summary":"s","roles":{"A":"a","B":"b","C":"c","D":"d"},"phases":[{"name":"x"}],'
        '"target_cell":{"pressure":"boxing","first_threat":"none"}}')


class _Planner(swarm.PlannerRouter):
    def __init__(self, http):
        super().__init__("http://x", "k", http=http, prompt=swarm.CAMPAIGN_PLANNER_PROMPT)


def test_behaviour_cell():
    e = lambda a, src="0g": {"source": src, "action": a}
    ents = [e("A:BRAKE_HARD B:CUT_IN"), e("A:BRAKE_HARD B:KEEP_LANE"), e("A:SLOW_ROLL B:WEAVE"), e(None, "none")]
    assert swarm.behaviour_cell(ents, {"threat_onset_t_s": 4.0}) == ["lateral", "early"]  # 2 vs 2: tie -> lateral
    assert swarm.behaviour_cell(ents + [e("A:BRAKE_PULSE B:WEAVE")], {"threat_onset_t_s": 6.0}) == ["braking", "mid"]
    assert swarm.behaviour_cell([e("A:TAILGATE B:KEEP_LANE")], {"threat_onset_t_s": None}) == ["boxing", "none"]
    assert swarm.behaviour_cell([], {"threat_onset_t_s": 9.0}) == ["pace", "late"]


def test_archive_update_and_score():
    arc = {}
    ep = lambda i, k, ccs, valid=True: {"i": i, "run": f"r{i}", "plan_name": f"p{i}", "cell_key": k, "ccs": ccs,
                                       "valid": valid}
    assert campaign.update(arc, ep(0, "lateral|early", 0.5)) and arc["lateral|early"]["ccs"] == 0.5
    assert not campaign.update(arc, ep(1, "lateral|early", 0.9)) and arc["lateral|early"]["run"] == "r1"
    assert campaign.update(arc, ep(2, "boxing|none", 1.0, valid=False)) and "boxing|none" not in arc  # invalid: no elite
    assert campaign.score(0.8, True, True) == 1.3 and campaign.score(0.8, True, False) == 0.3
    v = campaign.archive_view(arc)
    assert v["cells"][0]["plan"] == "p1" and len(v["empty_cells"]) == 15 and "pressure" in v["axes"]
    assert campaign.archive_view(arc, 1)["empty_cells"] == v["empty_cells"][1:] + v["empty_cells"][:1]


def test_campaign_runs_and_page(tmp_path):
    plans = [PLAN % i for i in range(2)]
    http = _Http(plans)  # planner calls pop the plans; executor calls get KEEP4
    root = tmp_path / "camp"
    d = campaign.run_campaign(root / "archive", 2, True, 7, _Planner(http), lambda: swarm.JointRouter(
        "http://x", "k", http=_Http([])), log=lambda m: None)
    briefs = [b["messages"][1]["content"] for b in http.bodies]
    assert '"archive"' in briefs[0] and '"empty_cells"' in briefs[0]
    assert len(d["episodes"]) == 2 and d["episodes"][0]["target_cell"]["pressure"] == "boxing"
    assert d["episodes"][0]["cell"] == ["pace", d["episodes"][0]["cell"][1]]  # executor kept lanes only
    assert d["coverage"] >= 1 and (root / "archive" / "ep-00" / "decisions.html").exists()
    assert d["episodes"][0]["layout"] == swarm.sample_scenario(7).layout
    page = campaign.campaign_html(root).read_text()
    assert "Feint 0" in page and json.dumps("archive/ep-00/decisions.html")[1:-1] in page
