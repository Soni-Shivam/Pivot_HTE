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
    assert msg == '{"history":[],"observation":{"a":2,"b":1},"reply_schema":{"action":"<one of available_actions>","why":"<=20 words"}}'

def test_scenario_hash_is_content_addressed():
    assert scenario_hash(DEMO) == scenario_hash(Scenario(seed=42)) != scenario_hash(Scenario(seed=43))
    assert DEMO.initial_gap_m == 35.0 and DEMO.runup_s == 3.0

def test_nonce_echo_is_required_when_bound():
    b = {"episode_id": "e" * 64, "commit_block": 7, "commit_blockhash": "0x" + "ab12cd34" + "0" * 56, "nonce": "ab12cd34"}
    assert parse_decision('{"action":"COAST","nonce":"ab12cd34"}', ACTIONS, "ab12cd34") == ("COAST", "ok")
    assert parse_decision('{"action":"COAST"}', ACTIONS, "ab12cd34") == (None, "bad_nonce")
    assert parse_decision('{"action":"COAST","nonce":"AB12CD34"}', ACTIONS, "ab12cd34") == (None, "bad_nonce")
    assert parse_decision('{"action":"COAST","nonce":"ab12cd34"}', ("MAINTAIN",), "ab12cd34") == (None, "out_of_set")
    assert parse_decision('{"action":"COAST"}', ACTIONS) == ("COAST", "ok")  # unbound runs need no nonce
    obs = {"gap_m": 1.0}
    assert build_user_message(obs, []).startswith('{"history":[],"observation":{"gap_m":1.0},"reply_schema"')
    msg = build_user_message(obs, [], b)
    assert msg.startswith('{"binding":{"commit_block":7,') and '"observation":{"gap_m":1.0}' in msg


def test_reply_schema_prelabels_the_nonce_and_the_parser_stays_strict():
    import json
    from faultline import cutin, policy
    b = {"episode_id": "e" * 64, "commit_block": 7, "commit_blockhash": "0xab12cd34" + "0" * 56, "nonce": "ab12cd34"}
    assert json.loads(build_user_message({}, [], b))["reply_schema"]["nonce"] == "<copy exactly: ab12cd34>"
    assert "nonce" not in json.loads(build_user_message({}, []))["reply_schema"]
    obs = {"available_actions": ["KEEP_LANE", "ACCELERATE"]}
    assert json.loads(build_user_message(obs, [], b))["reply_schema"]["action"] == "<one of: KEEP_LANE | ACCELERATE>"
    for p in (policy.SYSTEM_PROMPT, cutin.SYSTEM_PROMPT):
        assert "reply_schema" in p
    # copying the label itself, or omitting the field, still halts
    assert parse_decision('{"action":"COAST","nonce":"<copy exactly: ab12cd34>"}', ACTIONS, "ab12cd34") == (None, "bad_nonce")
    assert parse_decision('{"action":"COAST","why":"x"}', ACTIONS, "ab12cd34") == (None, "bad_nonce")
