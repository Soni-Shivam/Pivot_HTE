import json
from dataclasses import replace

from faultline import smart_swarm, swarm, tactics
from tests.python.test_swarm import _Http


def _rows(delay=0.8, decel=5.0, hw=1.5, dt=0.05):
    rows, t = [], 0.3
    while t < 6.0:
        lead_brakes, ego_brakes = t >= 3.0, t >= 3.0 + delay
        rows.append({"t_s": round(t, 2), "ego_v": 8.0, "ego_a": -decel if ego_brakes else 0.0,
                     "gt_gap": 2.0 + hw * 8.0, "gt_in_path": True, "lead_v": 8.0,
                     "lead_a": -4.0 if lead_brakes else 0.0})
        t += dt
    return rows


def test_identify_recovers_delay_decel_headway():
    m = tactics.identify(_rows(delay=0.8, decel=5.0, hw=1.5))
    assert abs(m["reaction_delay_s"] - 0.8) <= 0.06 and m["n_reaction_events"] == 1
    assert m["peak_decel_observed_mps2"] == 5.0 and abs(m["headway_s"] - 1.5) < 0.01 and m["source"] == "fit"
    p = tactics.identify([])
    assert p["source"] == "prior" and p["reaction_delay_s"] == tactics.PRIOR.reaction_delay_s


def _close_world(gap_arc=7.0, v=10.0):
    s = replace(swarm.SwarmScenario(seed=0), ego_speed_mps=v,
                cars=(("A", 0.0, gap_arc, v), ("B", 3.5, 0.0, v)))
    w = swarm.KinematicSwarmWorld(swarm.IdmParams(desired_speed_mps=v))
    w.reset(s)
    return w, replace(w.tick(), ego_a=0.0), s  # ego not yet reacting


def test_unescapable_brake_check_is_filtered_and_ranked():
    w, last, s = _close_world()
    av = {"A": ("KEEP_LANE", "BRAKE_HARD"), "B": ("KEEP_LANE",)}
    cands, allowed = tactics.evaluate(w, last, s, av, tactics.identify([]))
    by = {c["actions"]["A"]: c for c in cands}
    assert by["BRAKE_HARD"]["fair"] is False and by["BRAKE_HARD"]["escape"] is None  # left lane occupied by B
    assert by["KEEP_LANE"]["fair"] is True and allowed == {"A": ("KEEP_LANE",), "B": ("KEEP_LANE",)}
    assert [c["fair"] for c in cands] == sorted((c["fair"] for c in cands), reverse=True)
    assert tactics.menu_rows(cands) and all(r["A"] == "KEEP_LANE" for r in tactics.menu_rows(cands))


def test_far_brake_is_fair_and_ranked_above_keep_lane():
    w, last, s = _close_world(gap_arc=25.0)
    cands, allowed = tactics.evaluate(w, last, s, {"A": ("KEEP_LANE", "BRAKE_HARD"), "B": ("KEEP_LANE",)},
                                      tactics.identify([]))
    assert allowed["A"] == ("KEEP_LANE", "BRAKE_HARD") and cands[0]["actions"]["A"] == "BRAKE_HARD"
    assert cands[0]["criticality"] > cands[1]["criticality"]


def test_audit_and_summary_bookkeeping():
    mk = lambda a, crit, fair=True: {"actions": {"A": a}, "criticality": crit, "fair": fair, "min_ttc_s": 1.0}
    cands = [mk("BRAKE_HARD", 3.0), mk("SLOW_DOWN", 2.0), mk("CUT_IN", 9.0, fair=False)]
    a1 = tactics.audit(0, 2.0, {"A": "BRAKE_HARD"}, cands)
    a2 = tactics.audit(1, 3.0, {"A": "SLOW_DOWN"}, cands)
    a3 = tactics.audit(2, 4.0, None, cands)
    assert not a1["deviated"] and a1["regret"] == 0 and a1["chosen_rank"] == 0
    assert a2["deviated"] and a2["regret"] == 1.0 and a2["chosen_rank"] == 1 and a3["chosen"] is None
    traj = [{"t_s": 3.5, "gt_ttc_s": 0.7}]  # realized below the best's forecast 1.0 s -> the deviation paid off
    s = tactics.summarize([a1, a2, a3], traj)
    assert s["decisions"] == 2 and s["deviations"] == 1 and s["deviations_paid_off"] == 1
    assert s["mean_regret"] == 0.5 and s["top1_rate"] == 0.5 and s["chosen_fair_rate"] == 1.0


def test_smart_episode_filters_menu_and_logs_audit(tmp_path):
    r = swarm.JointRouter("http://x", "k", http=_Http([]))  # KEEP_LANE for every car, every checkpoint
    m = smart_swarm.run(swarm.KinematicSwarmWorld(), r, swarm.SwarmScenario(seed=0), tmp_path, "tactics")
    d = [json.loads(x) for x in (tmp_path / "decisions.jsonl").read_text().splitlines()]
    assert d and all(e["source"] == "0g" for e in d)
    assert "ego_model" in d[0]["observation"] and d[0]["observation"]["forecast"][0]["escape"] in ("brake", "left_lane")
    a = [json.loads(x) for x in (tmp_path / "tactics.jsonl").read_text().splitlines()]
    assert len(a) == len(d) and m["tactics"]["decisions"] == len(d) and swarm.forecast.__module__ == "faultline.swarm"
