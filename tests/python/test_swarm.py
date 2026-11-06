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


KEEP4 = '{"A":"KEEP_LANE","B":"KEEP_LANE","C":"KEEP_LANE","D":"KEEP_LANE"}'


class _Http:
    def __init__(self, contents):
        self.contents, self.bodies = list(contents), []

    def post(self, url, json, headers, timeout):
        assert headers["X-0G-Provider-Trust-Mode"] == "private"
        self.bodies.append(json)
        return _Resp(self.contents.pop(0) if self.contents else KEEP4)


AV = {"A": ("KEEP_LANE", "BRAKE_HARD"), "B": ("KEEP_LANE", "CUT_IN")}


def test_parse_joint_strict():
    assert swarm.parse_joint('{"A":"BRAKE_HARD","B":"CUT_IN","why":"x"}', AV) == (
        {"A": "BRAKE_HARD", "B": "CUT_IN"}, "ok")
    assert swarm.parse_joint('{"A":"CUT_IN","B":"CUT_IN"}', AV) == (None, "out_of_set")  # A has no cut-in
    assert swarm.parse_joint('{"A":"KEEP_LANE"}', AV) == (None, "out_of_set")  # one car missing -> all halt
    assert swarm.parse_joint('{"A":"KEEP_LANE","B":"FLY"}', AV) == (None, "out_of_set")  # one bad car -> all halt
    assert swarm.parse_joint('```json\n{"A":"KEEP_LANE","B":"KEEP_LANE"}```', AV) == (None, "invalid_json")
    assert swarm.parse_joint('[1]', AV) == (None, "invalid_json")


def test_parse_plan():
    ok = '<think>hm</think>{"name":"Pincer","summary":"s","roles":{"A":"x","B":"y"},"phases":[{"name":"p"}]}'
    assert swarm.parse_plan(ok, ("A", "B"))[1] == "ok"
    assert swarm.parse_plan('{"name":"P","roles":{"A":"x"},"phases":[{}]}', ("A", "B")) == (None, "bad_plan")
    assert swarm.parse_plan("", ("A",)) == (None, "invalid_json")


def test_episode_joint_actions_then_one_bad_car_halts_all(tmp_path):
    good = '{"phase":"squeeze","A":"KEEP_LANE","B":"CUT_IN_AGGRESSIVE","C":"ACCELERATE","D":"KEEP_LANE","why":"box"}'
    bad = '{"A":"KEEP_LANE","B":"KEEP_LANE","C":"KEEP_LANE","D":"CUT_IN"}'  # D (ego lane, behind) has no cut-in
    http = _Http([good, bad])
    r = swarm.JointRouter("http://x", "k", http=http)
    m = swarm.run_swarm_episode(swarm.KinematicSwarmWorld(), r, swarm.SwarmScenario(seed=0), tmp_path)
    d = [json.loads(x) for x in (tmp_path / "decisions.jsonl").read_text().splitlines()]
    assert [e["source"] for e in d] == ["0g", "none"]
    assert d[0]["action"] == "A:KEEP_LANE B:CUT_IN_AGGRESSIVE C:ACCELERATE D:KEEP_LANE" and d[0]["phase"] == "squeeze"
    assert d[1]["reason"] == "out_of_set" and m["status"] == "interrupted"
    assert set(d[1]["control"]) == {"A", "B", "C", "D"}
    assert all(c["control_accel_mps2"] == -3.0 for c in d[1]["control"].values())  # every car got SAFE_HALT
    assert http.bodies[0]["messages"][0]["content"] == swarm.SYSTEM_PROMPT and http.bodies[0]["max_tokens"] == 240
    rows = [json.loads(x) for x in (tmp_path / "trajectory.jsonl").read_text().splitlines()]
    assert any(r["cars"]["B"]["in_path"] for r in rows)


def test_failed_plan_halts_every_checkpoint_without_calls(tmp_path):
    http = _Http([])
    r = swarm.JointRouter("http://x", "k", http=http)
    pe = {"plan": None, "content_sha256": None, "request_id": "rq", "latency_ms": 1}
    m = swarm.run_swarm_episode(swarm.KinematicSwarmWorld(), r, swarm.SwarmScenario(seed=0), tmp_path, plan_entry=pe)
    assert http.bodies == [] and m["decisions_0g"] == 0 and m["decisions_halt"] == 1 and m["status"] == "interrupted"


def test_planner_uses_thinking_and_parses(tmp_path):
    plan = '{"name":"Rolling roadblock","summary":"s","roles":{"A":"a","B":"b","C":"c","D":"d"},"phases":[{"name":"x"}]}'
    http = _Http([plan])
    e = swarm.run_planner(swarm.PlannerRouter("http://x", "k", http=http), swarm.SwarmScenario(seed=0), tmp_path,
                          avoid=["Pincer"])
    b = http.bodies[0]
    assert b["chat_template_kwargs"] == {"enable_thinking": True} and b["max_tokens"] == 6000
    assert '"avoid_patterns":["Pincer"]' in b["messages"][1]["content"]
    assert e["plan"]["name"] == "Rolling roadblock" and e["request_id"] == "rid" and len(e["content_sha256"]) == 64
    assert json.loads((tmp_path / "plan.json").read_text())["source"] == "0g"


def test_available_sets_per_car():
    w = swarm.KinematicSwarmWorld()
    s = swarm.SwarmScenario(seed=0)
    w.reset(s)
    last = w.tick()
    av = swarm.available_map(swarm.observation(w, last, s, 0))
    assert "CUT_IN" not in av["A"] and "CUT_IN" not in av["D"]  # ego lane cars never cut in
    assert "CUT_IN_AGGRESSIVE" in av["B"]  # left lane, 4 m ahead, slot free
    assert "CUT_IN" not in av["C"]  # alongside: gap < 3 m
    w.advs["A"].v = 0.0
    assert "BRAKE_HARD" not in swarm.available_for("A", w.advs, last.ego_x, 0.0, w.dims)
    w.advs["A"].arc = w.advs["B"].arc  # A beside B in the ego lane -> B's slot is busy
    assert "CUT_IN" not in swarm.available_for("B", w.advs, last.ego_x, 0.0, w.dims)


def test_ego_follows_nearest_car_ahead_not_the_rear_car():
    w = swarm.KinematicSwarmWorld()
    w.reset(swarm.SwarmScenario(seed=0))
    st = w.tick()
    assert st.gt_in_path and abs(st.lead_x - w.advs["A"].arc) < 1e-9 and st.gt_gap > 0


def test_guard_keeps_cars_apart_and_off_the_ego():
    w = swarm.KinematicSwarmWorld()
    s = swarm.SwarmScenario(seed=0)
    w.reset(s)
    a, b = w.advs["A"], w.advs["B"]
    b.arc, b.lat, b.v, a.v = a.arc - 4.7 - 9.0, 0.0, 9.0, 0.0  # B 9 m behind a stopped A, same lane, closing at 9
    guarded = 0
    for _ in range(60):
        st = w.tick()
        guarded += "B" in w.guarded
        assert not st.adv_contact
    assert w.advs["B"].v < 0.01 and b.a == 0.0 and guarded  # stopped by the guard; commanded accel untouched
    w.reset(s)
    d = w.advs["D"]
    d.v, d.a = 14.0, 1.5  # rear car charging at the ego
    for _ in range(80):
        st = w.tick()
        assert not st.collision
    assert d.arc < w.ego_x


def test_forecast_skips_rear_car_and_sorts():
    w = swarm.KinematicSwarmWorld()
    s = swarm.SwarmScenario(seed=0)
    w.reset(s)
    last = w.tick()
    av = swarm.available_map(swarm.observation(w, last, s, 0))
    f = swarm.forecast(w, last, s, av, rows=500)
    assert len(f) == len(av["A"]) * len(av["B"]) * len(av["C"]) and "D" not in f[0]
    key = [(r["collision"], r["adversaries_touch"]) for r in f]
    assert key == sorted(key)
    assert len(swarm.forecast(w, last, s, av)) <= swarm.FORECAST_ROWS
