import json

import pytest

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


KEEP4 = '{"actions":{"A":"KEEP_LANE","B":"KEEP_LANE","C":"KEEP_LANE","D":"KEEP_LANE"}}'


class _Http:
    def __init__(self, contents):
        self.contents, self.bodies = list(contents), []

    def post(self, url, json, headers, timeout):
        assert headers["X-0G-Provider-Trust-Mode"] == "private"
        self.bodies.append(json)
        return _Resp(self.contents.pop(0) if self.contents else KEEP4)


AV = {"A": ("KEEP_LANE", "BRAKE_HARD"), "B": ("KEEP_LANE", "CUT_IN")}


def test_parse_joint_strict():
    j = lambda a: json.dumps({"actions": a, "phase": "p", "why": "x"})
    assert swarm.parse_joint(j({"A": "BRAKE_HARD", "B": "CUT_IN"}), AV) == ({"A": "BRAKE_HARD", "B": "CUT_IN"}, "ok")
    assert swarm.parse_joint(j({"A": "CUT_IN", "B": "CUT_IN"}), AV) == (None, "out_of_set")  # A has no cut-in
    assert swarm.parse_joint(j({"A": "KEEP_LANE"}), AV) == (None, "out_of_set")  # one car missing -> all halt
    assert swarm.parse_joint(j({"A": "KEEP_LANE", "B": "FLY"}), AV) == (None, "out_of_set")  # one bad car -> all halt
    assert swarm.parse_joint('{"A":"KEEP_LANE","B":"KEEP_LANE"}', AV) == (None, "out_of_set")  # flat: no "actions"
    assert swarm.parse_joint('```json\n{"actions":{}}```', AV) == (None, "invalid_json")
    assert swarm.parse_joint('[1]', AV) == (None, "invalid_json")


def test_parse_plan():
    ok = '<think>hm</think>{"name":"Pincer","summary":"s","roles":{"A":"x","B":"y"},"phases":[{"name":"p"}]}'
    assert swarm.parse_plan(ok, ("A", "B"))[1] == "ok"
    assert swarm.parse_plan('{"name":"P","roles":{"A":"x"},"phases":[{}]}', ("A", "B")) == (None, "bad_plan")
    assert swarm.parse_plan("", ("A",)) == (None, "invalid_json")


def test_episode_joint_actions_then_one_bad_car_halts_all(tmp_path):
    good = ('{"actions":{"A":"KEEP_LANE","B":"CUT_IN_AGGRESSIVE","C":"ACCELERATE","D":"KEEP_LANE"},'
            '"phase":"squeeze","why":"box"}')
    bad = '{"actions":{"A":"KEEP_LANE","B":"KEEP_LANE","C":"KEEP_LANE","D":"CUT_IN"}}'  # D (ego lane) has no cut-in
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
    obs = swarm.observation(w, last, s, 0)
    assert "cannot cut in now: gap below 3 m" in obs["cars"]["C"]["state"]
    assert obs["reply_schema"]["actions"]["A"] == \
        "<one of: KEEP_LANE|ACCELERATE|SLOW_DOWN|BRAKE_HARD|BRAKE_PULSE|SLOW_ROLL|PULL_AWAY>"
    w.advs["A"].v = 0.0
    assert "BRAKE_HARD" not in swarm.available_for("A", w.advs, last.ego_x, 0.0, w.dims)  # stopped: no braking
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
    w.reset(s)  # kin-006: B cuts in behind a slowing A; the guard must brake B from the start of its lane change
    a, b = w.advs["A"], w.advs["B"]
    b.arc, b.v, a.arc, a.v, a.a = a.arc - 14.0, 10.0, a.arc, 3.0, -1.25
    b.command("CUT_IN")
    for _ in range(80):
        st = w.tick()
        assert not st.adv_contact
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
    f = swarm.forecast(w, last, s, av, rows=1000)
    assert len(av["A"]) * len(av["B"]) * len(av["C"]) > swarm.FORECAST_MAX_COMBOS  # -> classic actions only
    classic = lambda c: len([x for x in av[c] if x in swarm.cutin.ACTIONS])
    assert len(f) == classic("A") * classic("B") * classic("C") and "D" not in f[0]
    two = {"A": av["A"], "B": av["B"], "C": ("KEEP_LANE",)}
    assert len(swarm.forecast(w, last, s, two, rows=1000)) == len(av["A"]) * len(av["B"])  # small: every primitive
    key = [(r["collision"], r["adversaries_touch"]) for r in f]
    assert key == sorted(key)
    assert len(swarm.forecast(w, last, s, av)) <= swarm.FORECAST_ROWS


def _world(s=None):
    w = swarm.KinematicSwarmWorld()
    s = s or swarm.SwarmScenario(seed=0)
    w.reset(s)
    return w, s, w.tick()


def test_primitive_availability_and_strict_parse():
    w, s, last = _world()
    av = swarm.available_map(swarm.observation(w, last, s, 0))
    assert "TAILGATE" in av["D"] and all("TAILGATE" not in av[c] for c in "ABC")  # rear car in the ego lane only
    assert "BLOCK_ALONGSIDE" in av["C"] and "BLOCK_ALONGSIDE" in av["B"] and "BLOCK_ALONGSIDE" not in av["A"]
    assert "WEAVE" in av["B"] and "WEAVE" not in av["C"] and "WEAVE" not in av["A"]  # cut-in conditions
    assert all(p in av["A"] for p in ("BRAKE_PULSE", "SLOW_ROLL", "PULL_AWAY"))
    bad = json.dumps({"actions": {"A": "TAILGATE", "B": "WEAVE", "C": "KEEP_LANE", "D": "TAILGATE"}})
    assert swarm.parse_joint(bad, av) == (None, "out_of_set")  # A is ahead: no tailgate -> every car halts
    w.advs["A"].v = 0.0
    a = swarm.available_for("A", w.advs, last.ego_x, 0.0, w.dims)
    assert "BRAKE_PULSE" not in a and "SLOW_ROLL" not in a  # stopped


def test_primitives_execute_within_bounds():
    w, s, _ = _world()
    a, b, c, d = (w.advs[k] for k in "ABCD")
    a.command("BRAKE_PULSE")
    vs = []
    for _ in range(40):
        w.tick()
        vs.append(a.v)
    assert vs[0] < 8.0 and abs(vs[-1] - vs[20]) < 1e-9 and 8.0 - vs[-1] == pytest.approx(6.0 * 0.8, abs=0.31)
    w, s, _ = _world()
    a = w.advs["A"]
    a.command("SLOW_ROLL")
    for _ in range(200):
        w.tick()
    assert a.v == pytest.approx(s.crawl_speed_mps, abs=0.06)
    w, s, _ = _world()
    a = w.advs["A"]
    a.command("PULL_AWAY")
    for _ in range(100):
        w.tick()
    assert a.v == pytest.approx(w.ego_v + 3.0, abs=0.1)
    w, s, _ = _world()
    c, d = w.advs["C"], w.advs["D"]
    c.command("BLOCK_ALONGSIDE")
    d.command("TAILGATE")
    for _ in range(160):
        st = w.tick()
        assert not st.collision and not st.adv_contact
    assert abs(c.arc - w.ego_x) < 1.0 and abs(c.v - w.ego_v) < 0.2  # beside the ego, same speed
    gap = (w.ego_x - 4.9 / 2) - (d.arc + 4.7 / 2)
    assert gap == pytest.approx(max(3.0, 0.5 * w.ego_v), abs=0.6)
    w, s, _ = _world()
    b = w.advs["B"]
    lats = []
    b.command("WEAVE")
    for _ in range(80):
        st = w.tick()
        lats.append(b.lat)
        assert not st.collision
    assert min(lats) == pytest.approx(0.0, abs=1e-6) and lats[-1] == pytest.approx(3.5)  # in and back out


def test_sample_scenario_varied_and_frozen():
    from faultline.config import scenario_hash
    seen = set()
    for seed in range(40):
        sc = swarm.sample_scenario(seed)
        assert sc == swarm.sample_scenario(seed) and 2 <= len(sc.cars) <= 4 and sc.layout in swarm.LAYOUTS
        seen.add(sc.layout)
        for i, p in enumerate(sc.cars):
            assert 6.5 <= p[3] <= 9.5
            for q in sc.cars[i + 1:]:
                assert p[1] != q[1] or abs(p[2] - q[2]) > 4.7  # same lane: never overlapping
        w = swarm.KinematicSwarmWorld()
        w.reset(sc)
        for _ in range(40):
            assert not w.tick().adv_contact
    assert len(seen) == len(swarm.LAYOUTS)
    assert scenario_hash(swarm.sample_scenario(1)) != scenario_hash(swarm.sample_scenario(2))
