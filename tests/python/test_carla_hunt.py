import json

from faultline import carla_hunt as ch, cutin
from faultline.config import scenario_hash
from faultline.episode import run_episode


def test_environment_menu_is_frozen_bounded_and_hashed():
    base = cutin.CutInScenario(seed=1)
    assert cutin.check_environment(base) is None and base.environment is None
    hashes = set()
    for name in cutin.ENVIRONMENTS:
        s = cutin.with_environment(base, name)
        assert cutin.check_environment(s) is None and s.friction_mu == cutin.ENVIRONMENTS[name]["mu"]
        assert set(s.env_params["lidar"]) <= set(cutin.LIDAR_BOUNDS)
        hashes.add(scenario_hash(s))
    assert len(hashes) == len(cutin.ENVIRONMENTS)
    from dataclasses import replace
    s = cutin.with_environment(base, "dense_fog")
    assert cutin.check_environment(replace(s, friction_mu=0.9))  # friction must follow the environment
    assert cutin.check_environment(replace(s, environment="sunny_mars"))
    bad = {"weather": s.env_params["weather"], "lidar": {**s.env_params["lidar"], "noise_stddev": 0.5}}
    assert cutin.check_environment(replace(s, env_params=bad))
    try:
        cutin.with_environment(base, "nope")
        assert False
    except ValueError:
        pass


def test_validate_rejects_physically_impossible_experiments():
    p = dict(ch.BENIGN)
    assert ch.validate(p) is None
    assert "exceeds" in ch.validate({**p, "brake_mps2": 6.0, "environment": "hard_rain_night"})  # 0.8*g*0.5 = 3.9
    assert "lateral" in ch.validate({**p, "lane_change_s": 1.0})
    assert "predicted gap" in ch.validate({**p, "initial_gap_m": 3.0, "lead_speed_mps": 6.0, "cut_in_cp": 2})
    # hunt-002's sideswipe: 4 m ahead at the start, 8 m/s slower, crosses the line while alongside
    assert "sideswipe" in ch.validate({**p, "ego_speed_mps": 12.0, "lead_speed_mps": 4.0, "initial_gap_m": 20.0,
                                       "cut_in_cp": 0, "lane_change_s": 2.27})
    assert "integer" in ch.validate({**p, "cut_in_cp": 1.5})
    assert ch.validate({**p, "environment": "space"}) and ch.validate({**p, "extra": 1})


def test_script_runs_as_a_labelled_bundle_and_minimize_keeps_only_necessary_factors(tmp_path):
    p = {**ch.BENIGN, "brake_mps2": 5.0, "initial_gap_m": 6.0, "cut_in_cp": 0, "environment": "clear_noon"}
    m = run_episode(cutin.KinematicCutInWorld(), ch.ScriptDecider(p), ch.scenario_for(p), tmp_path)
    ds = [json.loads(l) for l in (tmp_path / "decisions.jsonl").read_text().splitlines()]
    assert ds[0]["action"] == "CUT_IN" and all(d["source"] == "scripted-hunt" for d in ds)
    assert "BRAKE_HARD" in [d["action"] for d in ds] and m["decisions_0g"] == 0
    o = ch.outcome(tmp_path)
    assert set(o) >= {"collision", "min_gap_m", "min_ttc_s", "brake_reaction_s"}
    # fake world: collides iff brake > 0 and gap < 10
    fake = lambda q: {"collision": q["brake_mps2"] > 0 and q["initial_gap_m"] < 10}
    r = ch.minimize({**p, "ego_speed_mps": 10.0}, fake)
    assert r["minimal_failing_case"]["ego_speed_mps"] == ch.BENIGN["ego_speed_mps"]
    assert {x["factor"] for x in r["necessary"]} == {"brake_mps2", "initial_gap_m"}
