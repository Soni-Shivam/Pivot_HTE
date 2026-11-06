from faultline.policy import parse_decision, ACTIONS, ACTION_DECEL, SAFE_HALT_DECEL, prompt_hash, build_user_message
from faultline.config import Scenario, DEMO, scenario_hash

def test_parse_accepts_exactly_one_json_object():
    assert parse_decision('{"action":"BRAKE_HARD","why":"x"}', ACTIONS) == ("BRAKE_HARD", "ok")
    assert parse_decision('Sure! {"action":"COAST"}', ACTIONS) == (None, "invalid_json")
    assert parse_decision('```json\n{"action":"COAST"}\n```', ACTIONS) == (None, "invalid_json")
    assert parse_decision('{"action":"BRAKE"}', ACTIONS) == (None, "out_of_set")
    assert parse_decision('{"action":"BRAKE_HARD"}', ("MAINTAIN",)) == (None, "out_of_set")
    assert parse_decision('', ACTIONS) == (None, "invalid_json")

def test_physics_table_and_prompt_are_frozen():
    assert ACTION_DECEL == {"MAINTAIN": 0.0, "COAST": 0.5, "BRAKE_SOFT": 2.5, "BRAKE_HARD": 6.0} and SAFE_HALT_DECEL == 3.0
    assert len(prompt_hash()) == 64
    msg = build_user_message({"b": 1, "a": 2}, [])
    assert msg == '{"history":[],"observation":{"a":2,"b":1}}'

def test_scenario_hash_is_content_addressed():
    assert scenario_hash(DEMO) == scenario_hash(Scenario(seed=42)) != scenario_hash(Scenario(seed=43))
    assert DEMO.initial_gap_m == 35.0 and DEMO.runup_s == 3.0
