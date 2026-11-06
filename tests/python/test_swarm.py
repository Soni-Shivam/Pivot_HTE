import json

from faultline import swarm


class _Resp:
    def __init__(self, content, status=200):
        self.status_code = status
        self.headers = {"Zg-Res-Key": "k"}
        body = {"x_0g_trace": {"request_id": "rid", "provider": "0xp"},
                "choices": [{"message": {"content": content}}]}
        self._j, self.content = body, json.dumps(body).encode()

    def json(self):
        return self._j


class _Http:
    def __init__(self, contents):
        self.contents, self.bodies = list(contents), []

    def post(self, url, json, headers, timeout):
        assert headers["X-0G-Provider-Trust-Mode"] == "private"
        self.bodies.append(json)
        return _Resp(self.contents.pop(0) if self.contents else '{"A":"KEEP_LANE","B":"KEEP_LANE"}')


AV = {"A": ("KEEP_LANE", "BRAKE_HARD"), "B": ("KEEP_LANE", "CUT_IN")}


def test_parse_joint_strict():
    assert swarm.parse_joint('{"A":"BRAKE_HARD","B":"CUT_IN","why":"x"}', AV) == (
        {"A": "BRAKE_HARD", "B": "CUT_IN"}, "ok")
    assert swarm.parse_joint('{"A":"CUT_IN","B":"CUT_IN"}', AV) == (None, "out_of_set")  # A has no cut-in
    assert swarm.parse_joint('{"A":"KEEP_LANE"}', AV) == (None, "out_of_set")
    assert swarm.parse_joint('```json\n{"A":"KEEP_LANE","B":"KEEP_LANE"}```', AV) == (None, "invalid_json")


def test_episode_joint_actions_then_garbage_halts_both(tmp_path):
    http = _Http(['{"A":"KEEP_LANE","B":"CUT_IN_AGGRESSIVE","why":"box"}', "not json"])
    r = swarm.JointRouter("http://x", "k", http=http)
    m = swarm.run_swarm_episode(swarm.KinematicSwarmWorld(), r, swarm.SwarmScenario(seed=0), tmp_path)
    d = [json.loads(x) for x in (tmp_path / "decisions.jsonl").read_text().splitlines()]
    assert [e["source"] for e in d] == ["0g", "none"]
    assert d[0]["action"] == "A:KEEP_LANE B:CUT_IN_AGGRESSIVE" and d[0]["request_id"] == "rid"
    assert d[1]["reason"] == "invalid_json" and m["status"] == "interrupted"
    assert set(d[1]["control"]) == {"A", "B"}  # both cars got the halt command
    assert http.bodies[0]["messages"][0]["content"] == swarm.SYSTEM_PROMPT
    rows = [json.loads(x) for x in (tmp_path / "trajectory.jsonl").read_text().splitlines()]
    assert any(r["cars"]["B"]["in_path"] for r in rows)  # B really entered the ego lane before the halt


def test_ego_follows_nearest_car():
    w = swarm.KinematicSwarmWorld()
    w.reset(swarm.SwarmScenario(seed=0))
    st = w.tick()
    assert st.gt_in_path and abs(st.lead_x - w.advs["A"].arc) < 1e-9  # only A is in the ego lane at start


def test_guard_keeps_b_off_a_and_forecast_covers_every_joint_action():
    w = swarm.KinematicSwarmWorld()
    s = swarm.SwarmScenario(seed=0)
    w.reset(s)
    a, b = w.advs["A"], w.advs["B"]
    b.arc, b.lat, b.v, a.v = a.arc - 4.7 - 9.0, 0.0, 9.0, 0.0  # B 9 m behind a stopped A, same lane, closing at 9
    for _ in range(60):
        st = w.tick()
        assert not st.adv_contact
    assert w.advs["B"].v < 0.01 and b.a == 0.0  # stopped by the guard; the commanded accel is untouched
    w.reset(s)
    last = w.tick()
    av = {"A": tuple(w.advs["A"].available()), "B": tuple(w.advs["B"].available())}
    f = swarm.forecast(w, last, s, av)
    assert len(f) == len(av["A"]) * len(av["B"]) and {"A", "B", "min_ttc_s", "collision"} <= set(f[0])
