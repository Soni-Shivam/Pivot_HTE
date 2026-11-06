# Faultline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CARLA 0.10 lead-brake episode whose lead vehicle is driven at 1 s checkpoints by `0gm-1.0-35b-a3b` on 0G's private tier, with LiDAR-measured criticality metrics, a hash-chained episode log on 0G Storage (one request ID and one independently verified provider signature per decision), deterministic recorded-decision replay, a real safe halt when 0G is unreachable, scenario/result commitments on Galileo, and a static verifier page.

**Architecture:** Python 3.12 (`faultline/`) owns the simulator, the checkpoint loop, the safe-halt state machine, LiDAR perception, metrics and the episode bundle on disk. TypeScript (`packages/episode/`) owns everything that touches 0G Storage, the Compute SDK verifier and the chain, and is called by Python as a subprocess for `commit` (before the first inference) and `publish`/`finalize` (after the loop). A `World` interface has two implementations: `CarlaWorld` (the product) and `KinematicWorld` (a 1-D model used by the automated tests and as the demo fallback).

**Tech Stack:** CARLA 0.10.0 (`~/carla/Carla-0.10.0-Linux-Shipping`, Town10HD_Opt), Python 3.12 venv `.venv` with the shipped cp312 wheel + `numpy==1.26.4` + `pytest`; Node 22 workspace already in the repo (`@0gfoundation/0g-storage-ts-sdk 1.2.13`, `viem`, `@noble/*`, `esbuild`, `tsx`), plus `@0gfoundation/0g-compute-ts-sdk 0.9.0`; Foundry (solc 0.8.28, cancun) on 0G Galileo (16602); 0G Router mainnet `https://router-api.0g.ai/v1`.

**Spec:** `docs/superpowers/specs/2026-11-06-faultline-0g-architecture-design.md` (read §2.1, §5, §6, §10 first).

## Global Constraints

- Private tier only: every Router call sends `X-0G-Provider-Trust-Mode: private`; a 503 or any failure is a halt, never a retry on another tier or model (SECURITY I9). Model id `0gm-1.0-35b-a3b`; `chat_template_kwargs: {"enable_thinking": false}`, `response_format: {"type":"json_object"}`, `temperature: 0`, `max_tokens: 120`, timeout 8 s, one retry only on HTTP 429 after `Retry-After` (cap 5 s).
- **No fake decisions.** A failed or invalid decision produces `source: "none"` and the SAFE_HALT maneuver (lead decelerates at 3.0 m/s² to a stop). The track disqualifies anything else.
- Nothing is called "verified" unless `processResponse(provider, zg_res_key) === true` for that decision. The Router's `tee_verified` flag does not appear for 0GM and is not used.
- Never print, log, or commit `.env` values. Node via `. ~/.nvm/nvm.sh` (Node 22). Exact dependency pins. `ethers` stays `6.13.1`; it is imported only in `packages/integrations/src/storage.ts` and, as the one new exception, in `packages/episode/src/verify.ts` for the Compute SDK wallet (add a `docs/TASKS.md` change-log line when you do).
- Never use the Storage SDK `encryption` option; seal with `packages/protocol/src/envelope.ts` (AES-256-GCM).
- Python code runs with `.venv/bin/python`; tests with `.venv/bin/python -m pytest tests/python -q`. TS tests with `npm test`. No new backend server, no trackers.
- MBRDI code: only `criticality_metrics/utils/kinematics.py` and `metrics/composite_scorer_v2.py` are vendored (MIT), with the attribution header in Task 1. Nothing from `src/e2e_core`.
- The CARLA server must be running on `127.0.0.1:2000` for Tasks 7, 8, 11, 13: `cd ~/carla/Carla-0.10.0-Linux-Shipping && nohup ./CarlaUnreal.sh -RenderOffScreen -quality-level=Low -nosound > /tmp/carla-server.log 2>&1 &` (check `ss -ltn | grep :2000`). Another project on this machine also uses CARLA; never start a second server if :2000 is taken, and restore async mode on exit.
- Commit after every task on branch `build/faultline`. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` only if the harness reminder asks for it; never put a model name in code or docs pushed to the repo.
- Paid calls (Router cents, Galileo gas from the deployer that holds 7.85 0G) are authorized by the user for this build; log every tx hash and request ID into `docs/evidence/`.

## Review Focus

1. 0G returns HTTP 200 with a JSON object that is syntactically valid but whose `action` is not in `available_actions` (e.g. `"BRAKE"`): expect SAFE_HALT with `reason: "out_of_set"`, no re-prompt. Test in Task 3.
2. 0G returns 200 with `content` containing the action JSON wrapped in prose or a code fence: expect a parse that accepts exactly one top-level JSON object and rejects anything else (`reason: "invalid_json"`). Test in Task 3.
3. The LiDAR corridor is empty for one scan (lead momentarily outside the fov, or occlusion): expect `gap=None`, metrics for that tick marked `applicable: false`, not `0` and not the previous value. Test in Task 4.
4. The ego collides during the SAFE_HALT maneuver: expect `status: "interrupted"` and `collision: true` both recorded, and the replay reproducing the halt. Test in Task 6.
5. A second tenant key opens the sealed bundle: expect the GCM tag failure from `open()`, no partial plaintext, and the public JSON containing no `scenario`, no raw `observation` objects and no `salt`. Test in Task 10.

---

### Task 0: Python package skeleton and test harness

**Files:**
- Create: `faultline/__init__.py` (empty), `tests/python/conftest.py`, `pyproject.toml` (minimal, `[tool.pytest.ini_options] testpaths=["tests/python"]`), `requirements-sim.txt`
- Modify: `README.md` (one line pointing to the spec until Task 14 rewrites it)

**Interfaces:**
- Produces: `.venv` with `carla==0.10.0`, `numpy==1.26.4`, `pytest==8.3.3`; `requirements-sim.txt` lists exactly those plus the local wheel path.

- [x] **Step 1:** Write `requirements-sim.txt`:
```
/home/sedrica-w/carla/Carla-0.10.0-Linux-Shipping/PythonAPI/carla/dist/carla-0.10.0-cp312-cp312-linux_x86_64.whl
numpy==1.26.4
requests==2.32.3
pytest==8.3.3
```
- [x] **Step 2:** Run `.venv/bin/pip install -r requirements-sim.txt` (the venv already exists; `pip install` is idempotent). Expected: no error; `.venv/bin/python -c "import carla, numpy, pytest"` prints nothing.
- [x] **Step 3:** Write `tests/python/conftest.py` that inserts the repo root into `sys.path` and defines a `tmp_run_dir` fixture (a `tmp_path / "runs" / "ep"` directory).
- [x] **Step 4:** Run `.venv/bin/python -m pytest tests/python -q`. Expected: `no tests ran`, exit 5.
- [x] **Step 5:** Commit: `git add pyproject.toml requirements-sim.txt faultline tests/python && git commit -m "faultline: python package skeleton"`.

### Task 1: Vendored criticality metrics (MIT, from MBRDI)

**Files:**
- Create: `faultline/metrics/__init__.py`, `faultline/metrics/kinematics.py`, `faultline/metrics/ccs_v2.py`, `faultline/metrics/ATTRIBUTION.md`
- Test: `tests/python/test_metrics.py`

**Interfaces:**
- Produces: `ttc_1d(gap, v_rel, clip_max=60.0) -> np.ndarray`, `thw(gap, v_ego, clip_max=10.0) -> np.ndarray`, `drac(gap, v_rel, clip_max=20.0) -> np.ndarray` (copied verbatim from `~/shivam/mbrdi-development/sedrica_experiments/criticality_metrics/utils/kinematics.py`, transform helpers dropped); `score(drac, ttc2d, thw) -> CriticalityBreakdown`, `score_episode(dracs, ttc2ds, thws) -> dict`, `badge(ccs) -> str`, `Thresholds` (copied verbatim from `metrics/composite_scorer_v2.py`). We pass the 1-D TTC in the `ttc2d` slot; the breakdown keeps the key name `ttc2d` so numbers stay comparable with MBRDI reports.

- [x] **Step 1:** Write `tests/python/test_metrics.py`:
```python
import math, numpy as np
from faultline.metrics.kinematics import ttc_1d, thw, drac
from faultline.metrics.ccs_v2 import score, score_episode, badge, Thresholds

def test_kinematics_car_following():
    assert float(ttc_1d(np.array(21.0), np.array(5.6))) == 3.75
    assert float(thw(np.array(21.0), np.array(23.1))) == 21.0 / 23.1
    assert math.isclose(float(drac(np.array(21.0), np.array(5.6))), 5.6**2 / 42.0)
    assert float(ttc_1d(np.array(21.0), np.array(-1.0))) == 60.0   # opening: clipped, not negative
    assert float(drac(np.array(21.0), np.array(-1.0))) == 0.0

def test_ccs_midpoints_and_fuzzy_or():
    b = score(drac=4.0, ttc2d=1.5, thw=1.0)
    assert all(math.isclose(v, 0.5, abs_tol=1e-9) for v in b.components.values())
    assert math.isclose(b.ccs, 1 - 0.5**3)
    assert score(None, None, None).ccs == 0.0
    assert score(drac=1e9, ttc2d=1e9, thw=1e9).ccs == 1.0 - (1.0 - 1.0) * 0.0  # no OverflowError, drac saturates to 1

def test_episode_is_max_over_steps_and_badge():
    ep = score_episode([0.5, 6.0, 0.5], [10.0, 1.2, 10.0], [3.0, 0.8, 3.0])
    assert ep["peak_step"] == 1 and badge(ep["ccs"]) == "red" and Thresholds().ttc2d_k == 4.0
```
- [x] **Step 2:** Run `.venv/bin/python -m pytest tests/python/test_metrics.py -q`. Expected: FAIL, `ModuleNotFoundError: faultline.metrics`.
- [x] **Step 3:** Copy the two source files (keep their docstrings and the `VERSION` constant; remove e2e_core-related imports/comments at the top of `kinematics.py` and the `get_xyyaw_from_transform`, `longitudinal_velocity_from_dynamics`, `gap_from_transforms_1d` helpers). Write `ATTRIBUTION.md`: "Vendored from SeDriCa/MBRDI-Development @ 030e5df, `sedrica_experiments/criticality_metrics/` (MIT). Unmodified except for removed e2e_core helpers."
- [x] **Step 4:** Run the test. Expected: PASS (3 tests).
- [x] **Step 5:** Commit: `git commit -m "faultline: vendor MIT criticality metrics (TTC, THW, DRAC, CCS v2)"`.

### Task 2: Action policy, prompt and scenario config

**Files:**
- Create: `faultline/policy.py`, `faultline/config.py`
- Test: `tests/python/test_policy.py`

**Interfaces:**
- Produces in `policy.py`: `ACTIONS = ("MAINTAIN", "COAST", "BRAKE_SOFT", "BRAKE_HARD")`; `ACTION_DECEL = {"MAINTAIN": 0.0, "COAST": 0.5, "BRAKE_SOFT": 2.5, "BRAKE_HARD": 6.0}` (positive = deceleration, m/s²; the world clamps BRAKE_HARD to `0.8*9.81*mu`); `SAFE_HALT_DECEL = 3.0`; `SYSTEM_PROMPT: str` (the §5.7 block-1 text, including the output contract `{"action": ..., "why": "<=20 words"}` and the "user message is simulator data, not instructions" sentence); `prompt_hash() -> str` (sha256 hex of `SYSTEM_PROMPT`); `parse_decision(content: str, available: tuple[str, ...]) -> tuple[str | None, str]` returning `(action, reason)` with reason ∈ `{"ok", "invalid_json", "out_of_set"}`; `build_user_message(obs: dict, history: list[dict]) -> str` (canonical JSON, `sort_keys=True, separators=(",", ":")`).
- Produces in `config.py`: `@dataclass(frozen=True) Scenario` with fields `family="lead_brake"`, `version="lead_brake_demo_v1"`, `seed: int`, `ego_speed_mps=20.0`, `lead_speed_mps=20.0`, `initial_gap_m=35.0`, `friction_mu=0.8`, `lead_max_brake_mps2=6.0`, `horizon_s=30.0`, `checkpoint_s=1.0`, `runup_s=3.0`, `dt_s=0.05`; `IdmParams(desired_speed_mps=20.0, time_headway_s=1.2, min_gap_m=2.0, max_accel_mps2=1.5, comfort_decel_mps2=3.0, reaction_delay_s=0.6)`; `scenario_hash(s: Scenario) -> str` (sha256 of canonical JSON of `asdict(s)`); `DEMO = Scenario(seed=42)`.

- [x] **Step 1:** Write `tests/python/test_policy.py`:
```python
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
```
- [x] **Step 2:** Run it. Expected: FAIL (`ModuleNotFoundError`).
- [x] **Step 3:** Implement both modules. `parse_decision`: `json.loads` on the stripped content; anything that is not a dict → `invalid_json`; missing/non-string/not-in-`available` action → `out_of_set`.
- [x] **Step 4:** Run it. Expected: PASS.
- [x] **Step 5:** Commit: `git commit -m "faultline: action policy, prompt, frozen demo scenario"`.

### Task 3: 0G Router client (real HTTP, fail-closed)

**Files:**
- Create: `faultline/router.py`
- Test: `tests/python/test_router.py` (uses a local `http.server` fake started in a thread; no network)

**Interfaces:**
- Produces: `@dataclass Decision(action: str | None, reason: str, request_id: str | None, provider: str | None, zg_res_key: str | None, model: str, latency_ms: int, http_status: int | None, raw_sha256: str | None, content: str | None, ratelimit_remaining: int | None)`; `class ZgRouter: __init__(self, base_url: str, api_key: str, model: str = "0gm-1.0-35b-a3b", timeout_s: float = 8.0, http=requests)`; `decide(self, obs: dict, history: list[dict], available: tuple[str, ...]) -> Decision`. `reason` ∈ `{"ok","invalid_json","out_of_set","timeout","unreachable","http_429","http_5xx","http_other","no_request_id","no_provider_for_trust_mode"}`. Headers sent: `Authorization: Bearer`, `X-0G-Provider-Trust-Mode: private`, `Content-Type`. Body exactly the Global Constraints request. `request_id` = `X-Request-Id` header, else `x_0g_trace.request_id`; `zg_res_key` = `Zg-Res-Key` header (case-insensitive); `provider` = `x_0g_trace.provider`. A 200 with no request id → `reason "no_request_id"`, `action None`. 429 → sleep `min(Retry-After, 5)` and retry once; a second 429 → `"http_429"`. 503 with `error.code == "no_provider_for_trust_mode"` → that reason. Never a second model or tier.

- [x] **Step 1:** Write `tests/python/test_router.py` with a `FakeRouter` (threaded `HTTPServer`) whose handler reads a module-level `MODE` ∈ `ok | prose | out_of_set | r429_then_ok | r502 | r503_trust | no_reqid | slow | garbage` and asserts the incoming header `X-0G-Provider-Trust-Mode == "private"` and `json body["model"] == "0gm-1.0-35b-a3b"` (fail the request with 400 otherwise). Tests:
```python
def test_ok_decision_records_trace():   # MODE=ok returns 200, headers X-Request-Id: r1, Zg-Res-Key: k1, body with x_0g_trace.provider "0xabc", content '{"action":"BRAKE_SOFT","why":"w"}'
    d = router.decide(OBS, [], ACTIONS); assert (d.action, d.reason, d.request_id, d.zg_res_key, d.provider) == ("BRAKE_SOFT","ok","r1","k1","0xabc") and d.latency_ms >= 0 and len(d.raw_sha256) == 64
def test_prose_and_out_of_set_are_failures(): ...  # reasons invalid_json / out_of_set, action None, request_id still recorded
def test_429_retries_once_then_fails(): ...        # r429_then_ok → ok after one retry (server counts 2 requests); a permanent 429 → "http_429" after exactly 2 requests
def test_502_503_no_reqid(): ...                   # "http_5xx", "no_provider_for_trust_mode", "no_request_id"; exactly one request each
def test_timeout_and_unreachable():               # slow handler sleeps 2 s with timeout_s=0.5 → "timeout"; base_url on a closed port → "unreachable"
def test_never_changes_model_or_tier():            # after any failure the server saw no request with another model or header value (the handler's 400 would have surfaced)
```
- [x] **Step 2:** Run it. Expected: FAIL (`ModuleNotFoundError`).
- [x] **Step 3:** Implement `faultline/router.py` with `requests` (already pinned). Compute `raw_sha256` over the response bytes. Do not log the key.
- [x] **Step 4:** Run it. Expected: PASS (6 tests).
- [x] **Step 5:** Live smoke (paid, cents): `.venv/bin/python -c "..."` calling `ZgRouter(env ZG_ROUTER_URL, ZG_API_KEY).decide(OBS_FROM_SPEC, [], ACTIONS)` and print `action, reason, request_id, provider, zg_res_key, latency_ms` (never the key). Expected: `reason == "ok"`, an action in the set, 64-hex `raw_sha256`. Append the printed line to `docs/evidence/faultline-router-smoke.log`.
- [x] **Step 6:** Commit: `git commit -m "faultline: fail-closed 0G Router client with fake-server tests"`.

### Task 4: LiDAR perception (gap and closing speed from the point cloud)

**Files:**
- Create: `faultline/perception.py`
- Test: `tests/python/test_perception.py`

**Interfaces:**
- Produces: `corridor_gap(points: np.ndarray, front_offset_m: float, half_width_m: float = 1.4, z_min: float = -1.5, z_max: float = 0.8, min_points: int = 3) -> float | None` where `points` is `(N, 4)` float32 `[x, y, z, intensity]` in the sensor frame (x forward, y right, z up; CARLA LiDAR convention), returns bumper-to-bumper gap = `percentile_5(x of corridor points) - front_offset_m`, or `None` if fewer than `min_points` corridor points; `class GapTracker: __init__(self, window: int = 5, dt_s: float = 0.05)`, `update(self, gap: float | None) -> tuple[float | None, float | None]` returning `(gap, closing_speed_mps)` where closing speed is the negative slope of a least-squares line through the last `window` valid gaps (needs ≥ 3 valid samples, else `None`); a `None` gap resets the window.

- [x] **Step 1:** Write `tests/python/test_perception.py`:
```python
def _box(x0, n=200):  # points on the rear face of a car at longitudinal x0, 1.8 m wide, 0.3..1.2 m above ground (sensor at 1.9 m → z in [-1.6, -0.7])
    rng = np.random.default_rng(0); return np.column_stack([np.full(n, x0) + rng.normal(0, 0.02, n), rng.uniform(-0.9, 0.9, n), rng.uniform(-1.6, -0.7, n), np.ones(n)]).astype(np.float32)
def _ground(n=2000): ...  # z = -1.9 ± 0.02, x in [2, 60], y in [-6, 6]
def test_gap_ignores_ground_and_side_lane():
    pts = np.vstack([_ground(), _box(20.0), _box(12.0) + np.array([0, 3.6, 0, 0], np.float32)])  # second car one lane to the right
    assert abs(corridor_gap(pts, front_offset_m=2.4) - 17.6) < 0.1
def test_empty_corridor_is_none_not_zero():
    assert corridor_gap(_ground(), 2.4) is None and corridor_gap(_box(20.0)[:2], 2.4) is None
def test_tracker_closing_speed_and_reset():
    t = GapTracker(window=5, dt_s=0.05); out = [t.update(30.0 - 0.3 * i) for i in range(5)]   # 6 m/s closing
    assert out[0] == (30.0, None) and out[1][1] is None and abs(out[4][1] - 6.0) < 1e-6
    assert t.update(None) == (None, None) and t.update(28.0)[1] is None
```
- [x] **Step 2:** Run it. Expected: FAIL.
- [x] **Step 3:** Implement with numpy only (`np.percentile`, `np.polyfit(deg=1)`).
- [x] **Step 4:** Run it. Expected: PASS.
- [x] **Step 5:** Commit: `git commit -m "faultline: LiDAR corridor gap and closing-speed tracker"`.

### Task 5: World interface, kinematic world, IDM follower, lead longitudinal controller

**Files:**
- Create: `faultline/world.py` (the `World` protocol and `KinematicWorld`), `faultline/controller.py`
- Test: `tests/python/test_world_kinematic.py`

**Interfaces:**
- Produces in `controller.py`: `class IdmFollower: __init__(self, p: IdmParams, dt_s: float)`, `accel(self, v_ego: float, gap: float, v_lead: float) -> float` (IDM: `a_max*(1-(v/v0)^4-(s*/gap)^2)`, `s* = s0 + v*T + v*dv/(2*sqrt(a_max*b))`, clamped to `[-0.8*9.81*mu_cap, a_max]`, where the caller passes a reaction-delayed `(gap, v_lead)` using an internal FIFO of `round(reaction_delay_s/dt_s)` samples; expose `observe(gap, v_lead)` that pushes and returns the delayed pair); `class LeadLongitudinal: __init__(self, dt_s: float)`, `set_decel(self, decel_mps2: float)`, `step(self, v_now: float, v_hold: float) -> float` returning the target acceleration (hold `v_hold` with `MAINTAIN` via `kp=0.8*(v_hold - v_now)` clamped to `[-1.0, 1.5]`; otherwise `-decel` until `v_now <= 0.05`, then 0).
- Produces in `world.py`: `class World(Protocol)` with `reset(self, s: Scenario) -> None`, `tick(self) -> "TickState"`, `set_lead_decel(self, decel_mps2: float | None) -> None` (`None` = MAINTAIN), `close(self) -> None`, property `t_s: float`; `@dataclass TickState(t_s, ego_x, ego_v, ego_a, lead_x, lead_v, lead_a, gt_gap, lidar_gap: float | None, lidar_closing: float | None, collision: bool)`; `class KinematicWorld(World)`: 1-D, semi-implicit Euler at `dt_s`, ego driven by `IdmFollower` using **true** gap/lead speed through the delay FIFO, `lidar_gap = gt_gap` (exact), `lidar_closing = ego_v - lead_v`, `collision = gt_gap <= 0`, `BRAKE_HARD` clamp `min(decel, 0.8*9.81*mu)`; bumper lengths: ego 4.9 m, lead 4.7 m (`gt_gap = lead_x - ego_x - (4.9+4.7)/2`).

- [x] **Step 1:** Write tests:
```python
def test_idm_holds_desired_speed_when_free():   # gap 500 m, v_lead 20 → after 600 ticks |v_ego-20| < 0.2
def test_idm_brakes_when_closing():            # v_ego 20, gap 15, v_lead 10 → accel < -2.0
def test_reaction_delay_is_12_ticks():          # observe() returns the value pushed 12 calls earlier at dt 0.05, delay 0.6
def test_kinematic_world_maintain_then_brake_hard():
    w = KinematicWorld(DEMO); w.reset(DEMO); [w.tick() for _ in range(60)]   # 3 s MAINTAIN: gap stays within 35 ± 1
    w.set_lead_decel(6.0); st = [w.tick() for _ in range(40)]
    assert st[-1].lead_v < st[0].lead_v - 10 and st[-1].gt_gap < 30 and st[-1].lidar_gap == st[-1].gt_gap
def test_kinematic_world_is_deterministic():    # two fresh worlds, same decel schedule → identical TickState sequences (==)
def test_brake_hard_is_clamped_by_friction():   # mu 0.3 → lead decel magnitude ≈ 0.8*9.81*0.3
```
- [x] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [x] **Step 5:** Commit: `git commit -m "faultline: World protocol, kinematic world, IDM follower, lead controller"`.

### Task 6: Episode runner: checkpoint loop, safe-halt state machine, hash-chained log, bundle

**Files:**
- Create: `faultline/episode.py`, `faultline/log.py`
- Test: `tests/python/test_episode.py` (KinematicWorld + a `FakeDecider` with a scripted list of `Decision`s)

**Interfaces:**
- Consumes: `World`, `TickState`, `ZgRouter.decide` signature (anything with `.decide(obs, history, available) -> Decision` is a decider), `policy`, `metrics`.
- Produces in `log.py`: `class ChainLog: __init__(self, path: Path)`, `append(self, entry: dict) -> str` (writes one JSON line with added fields `i` and `prev_hash`, returns `entry_hash = sha256(canonical(entry incl. prev_hash))`), `head -> str`; `verify_chain(path) -> bool`.
- Produces in `episode.py`: `run_episode(world: World, decider, scenario: Scenario, out_dir: Path, clock=time) -> dict` (the manifest). Behaviour:
  - states `READY → AWAITING_0G → EXECUTING → … | SAFE_HALT → INTERRUPTED`; checkpoints at `t = runup_s + k*checkpoint_s` (k ≥ 0) while `t < horizon_s`; before the first checkpoint the lead maintains.
  - observation dict = §5.2 fields computed from `TickState` (gap/closing/ttc/thw from **privileged** state for the adversary; `ttc_s = None` when not closing), `available_actions = list(ACTIONS)`; history = list of `{cp, your_action, gap_m, ego_speed_mps, ego_accel_mps2, ttc_s}` plus `ego_observed_reaction_delay_s` and `ego_min_ttc_so_far_s` as top-level history keys inside the user message's `history` object (`{"items":[...], "ego_observed_reaction_delay_s":..., "ego_min_ttc_so_far_s":...}`).
  - on `Decision.reason == "ok"`: `world.set_lead_decel(ACTION_DECEL[action] or None)`; else `set_lead_decel(SAFE_HALT_DECEL)`, state SAFE_HALT, no further 0G calls; keep ticking until `ego_v < 0.3 and lead_v < 0.3` or collision or 8 s after the halt began.
  - end conditions (EXECUTING): collision; `t >= horizon_s`; `ego_v < 0.3 and lead_v < 0.3` for 2 s.
  - per tick, metrics from the **LiDAR** fields: `ttc_1d(lidar_gap, lidar_closing)`, `thw(lidar_gap, ego_v)`, `drac(lidar_gap, lidar_closing)` when `lidar_gap is not None`, else all `None` and `applicable=False`; `score(...)` → `ccs`.
  - files in `out_dir`: `scenario.json`, `decisions.jsonl` (ChainLog; entry keys `cp, sim_time_s, observation, history, action, control_decel_mps2, source ("0g"|"none"), reason, model, request_id, provider, zg_res_key, latency_ms, raw_sha256, content`), `trajectory.jsonl` (one line per tick: `TickState` fields + `ttc_s, thw_s, drac_mps2, ccs, applicable`), `metrics.json` (`score_episode` output + `min_ttc_s, min_gap_m, max_ego_decel_mps2, collision, perception: {mean_abs_gap_error_m, max_abs_gap_error_m, scans_without_target}`), `manifest.json` (`schema "faultline.episode/v1", episode_id = sha256(scenario_hash + ":" + seed + ":" + started_at), scenario_hash, prompt_hash, model, trust_mode "private", status "completed"|"interrupted", collision, decisions_total, decisions_0g, decisions_halt, log_head, files: {name: sha256}, started_at, finished_at, world: "kinematic"|"carla-0.10.0"`).

- [ ] **Step 1:** Write tests (scripted deciders produce `Decision(...)` objects directly):
```python
def test_happy_path_logs_one_entry_per_checkpoint_with_chain(tmp_run_dir): # 28 ok decisions MAINTAIN → status completed, decisions_0g == number of checkpoints, verify_chain True, every entry has request_id
def test_brake_hard_decision_changes_motion(tmp_run_dir):                  # decider: MAINTAIN×3 then BRAKE_HARD… → min_gap_m < 20 and metrics["ccs"] > 0.5 (vs < 0.4 for the all-MAINTAIN run)
def test_failure_reasons_trigger_safe_halt_once(tmp_run_dir):              # for reason in ["timeout","unreachable","http_429","http_5xx","invalid_json","out_of_set","no_request_id","no_provider_for_trust_mode"]: exactly one entry with source "none", no later 0g entries, status interrupted, lead_v at end < 0.3
def test_collision_during_halt_records_both(tmp_run_dir):                  # Scenario(initial_gap_m=8, ego_speed 25, lead 10) + immediate "timeout" → collision True and status interrupted
def test_metrics_use_lidar_fields_and_mark_gaps(tmp_run_dir):              # a World wrapper that returns lidar_gap None on ticks 100..110 → those trajectory lines have applicable False and ttc_s None; metrics.perception.scans_without_target == 11
def test_history_grows_and_reaction_delay_is_estimated(tmp_run_dir):       # third decision's history has 2 items; after a BRAKE_HARD the next history has ego_observed_reaction_delay_s within 0.4..1.0 (IDM delay 0.6 + response)
```
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement `log.py` then `episode.py`. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "faultline: episode runner with safe-halt state machine and hash-chained log"`.

### Task 7: CARLA world and `run` CLI (first real episode with real 0G decisions)

**Files:**
- Create: `faultline/carla_world.py`, `faultline/cli.py` (`python -m faultline run|replay`), `faultline/__main__.py`
- Test: `tests/python/test_carla_world.py` marked `@pytest.mark.carla` (skipped unless `FAULTLINE_CARLA=1`)

**Interfaces:**
- Produces: `class CarlaWorld(World): __init__(self, host="127.0.0.1", port=2000, map_name="Town10HD_Opt", recorder_path: Path | None = None)`. `reset(s)`: load map if needed, sync mode `fixed_delta_seconds = s.dt_s`, pick the straight candidate (the spike's search: spawn points whose lane has ≥ 140 m junction-free ahead, sorted by `(road_id, lane_id, x, y)`, index `s.seed % len`), spawn ego `vehicle.lincoln.mkz` at the candidate and the lead `vehicle.taxi.ford` at `waypoint.next(initial_gap + (4.9+4.7)/2)`, both given `set_target_velocity` along the lane heading at their scenario speeds, attach `sensor.lidar.ray_cast` (channels 32, range 80, points_per_second 400000, rotation_frequency 20, upper_fov 5, lower_fov -20) at `(x=1.5, z=1.9)` and `sensor.other.collision` to the ego; start the recorder if a path is given. `tick()`: apply ego control from `IdmFollower` through a `VehiclePIDController`-free longitudinal map (throttle = clip(a/3, 0, 1), brake = clip(-a/8, 0, 1)) and lateral steer from a pure-pursuit on the lane waypoint 8 m ahead (same for the lead); `LeadLongitudinal` for the lead; `world.tick()`; read the latest LiDAR scan (queue) → `corridor_gap(points, front_offset_m = ego_bbox.extent.x - 1.5)` → `GapTracker`; `gt_gap` from bounding boxes projected on the lead heading; speeds via `math.hypot(v.x, v.y)`; collision from the sensor queue. `close()`: stop recorder, destroy actors, restore async settings (also in a `finally`).
- Produces in `cli.py`: `run --world carla|kinematic --seed 42 --out runs/<auto> [--model 0gm-1.0-35b-a3b] [--router-url URL] [--chaos unreachable|none] [--anchor]`; reads `ZG_ROUTER_URL`, `ZG_API_KEY` from `.env` (via `os.environ` after a tiny dotenv loader; never printed). `--chaos unreachable` replaces the router URL with `http://127.0.0.1:1` (a real failed connection). Prints the manifest summary and the per-decision table (`cp, action, source, reason, request_id, provider, latency_ms`). `--anchor` is wired in Task 11.

- [ ] **Step 1:** Write the carla-marked test: `CarlaWorld().reset(DEMO)`; 60 ticks MAINTAIN → `abs(gt_gap - 35) < 3`, `lidar_gap` within 1.5 m of `gt_gap` on ≥ 80 % of ticks, `ego_v` between 15 and 22; then `set_lead_decel(6.0)` 40 ticks → `lead_v` dropped by > 8 and `lidar_closing > 3`; `close()` restores `synchronous_mode False`.
- [ ] **Step 2:** Run with `FAULTLINE_CARLA=1 .venv/bin/python -m pytest tests/python/test_carla_world.py -q -s`. Expected: FAIL (module missing). **Step 3:** Implement. **Step 4:** Run. Expected: PASS. If the IDM ego cannot reach 15 m/s on the 140 m stretch, lengthen the candidate requirement to 200 m or start both vehicles at speed (already via `set_target_velocity`); record what you changed in the task's commit message.
- [ ] **Step 5:** First real episode (paid, cents): `.venv/bin/python -m faultline run --world carla --seed 42 --out runs/demo-001`. Expected: `status completed`, ≥ 20 decisions with `source 0g`, each with `request_id` and `zg_res_key`, `metrics.json` present, `recorder.log` present, `verify_chain` true. Save the printed table to `docs/evidence/faultline-demo-001.log`.
- [ ] **Step 6:** Scripted baseline for contrast: `run --world carla --seed 42 --decider maintain --out runs/baseline-001` (add a `--decider maintain` option that uses a local scripted decider **clearly labelled** `source: "scripted-baseline"`, never used when `--decider 0g`). Expected: lower `ccs` than demo-001.
- [ ] **Step 7:** Real halt (paid: none): `run --world carla --seed 42 --chaos unreachable --out runs/halt-001`. Expected: first checkpoint `reason unreachable`, `source none`, lead stops, `status interrupted`. Save to evidence.
- [ ] **Step 8:** Commit: `git commit -m "faultline: CARLA 0.10 world, run CLI, first live 0G episodes (evidence)"`.

### Task 8: Replay (recorded decisions, CARLA recorder playback)

**Files:**
- Create: `faultline/replay.py`
- Modify: `faultline/cli.py` (add `replay <run_dir> --world kinematic|carla [--out DIR]`)
- Test: `tests/python/test_replay.py`

**Interfaces:**
- Produces: `class RecordedDecider: __init__(self, decisions_path: Path)` whose `decide()` returns the logged `Decision` for the next checkpoint (same `action/reason/source`, `request_id` copied, `latency_ms 0`); `replay(run_dir: Path, world: World, out_dir: Path) -> dict` returning `{"trajectory_sha256_match": bool, "max_abs_gap_diff_m": float, "max_abs_v_diff_mps": float, "decisions_match": bool}` comparing `trajectory.jsonl` of the rerun with the original; `carla_playback_cmd(run_dir) -> str` returning the exact `python -m faultline playback` invocation that calls `client.replay_file(str(run_dir/"recorder.log"), 0, 0, 0)` and `show_recorder_file_info`.

- [ ] **Step 1:** Tests: a kinematic episode (scripted decider) replayed on a fresh `KinematicWorld` → `trajectory_sha256_match True`, `decisions_match True`; a halted episode replays to the same halt tick; tampering one byte of `decisions.jsonl` → `verify_chain False` and `replay` raises `ValueError("log chain broken")`.
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement (`replay` writes the rerun's own bundle to `out_dir` and a `replay.json` with the comparison). **Step 4:** Run. PASS.
- [ ] **Step 5:** CARLA replay of `runs/demo-001`: `python -m faultline replay runs/demo-001 --world carla --out runs/demo-001-replay`. Expected: `decisions_match True`; record `max_abs_gap_diff_m` (CARLA is not bit-deterministic; report it, do not hide it). Also run `python -m faultline playback runs/demo-001` and confirm it plays (the manifest gets `playback_ok: true` in `replay.json`). Save output to `docs/evidence/faultline-replay-001.log`.
- [ ] **Step 6:** Commit: `git commit -m "faultline: recorded-decision replay and CARLA recorder playback"`.

### Task 9: `EpisodeRegistry` contract on Galileo

**Files:**
- Create: `contracts/src/EpisodeRegistry.sol`, `contracts/test/EpisodeRegistry.t.sol`, `contracts/script/DeployRegistry.s.sol`
- Modify: `contracts/deployments/16602.json` (add `episodeRegistry`)

**Interfaces:**
- Produces (Solidity 0.8.28, no imports beyond forge-std in tests):
```solidity
struct Episode { address evaluator; bytes32 scenarioCommitment; bytes32 publicRoot; bytes32 sealedRoot; bytes32 resultCommitment; uint8 status; bool collision; uint64 committedAt; uint64 finalizedAt; }
function commitScenario(bytes32 episodeId, bytes32 scenarioCommitment) external;   // reverts AlreadyCommitted
function finalizeEpisode(bytes32 episodeId, bytes32 publicRoot, bytes32 sealedRoot, bytes32 resultCommitment, uint8 status, bool collision) external; // reverts NotEvaluator, NotCommitted, AlreadyFinalized, BadStatus (status must be 1 or 2)
function getEpisode(bytes32 episodeId) external view returns (Episode memory);
event ScenarioCommitted(bytes32 indexed episodeId, address indexed evaluator, bytes32 scenarioCommitment);
event EpisodeFinalized(bytes32 indexed episodeId, bytes32 publicRoot, bytes32 sealedRoot, bytes32 resultCommitment, uint8 status, bool collision);
```
- [ ] **Step 1:** Write `EpisodeRegistry.t.sol`: commit emits and stores `block.timestamp`; second commit reverts; finalize by another address reverts; finalize before commit reverts; finalize twice reverts; status 3 reverts; happy path stores all fields and emits.
- [ ] **Step 2:** `cd contracts && forge test --match-contract EpisodeRegistry -vv`. Expected: compile error (missing contract). **Step 3:** Implement. **Step 4:** Run. Expected: 7 passing.
- [ ] **Step 5:** Deploy: `forge script script/DeployRegistry.s.sol --rpc-url $RPC_URL --broadcast --gas-estimate-multiplier 150 --private-key $PRIVATE_KEY` (load `.env` with `set -a; . ../.env; set +a`; never echo it), then verify on `https://chainscan-galileo.0g.ai/open/api` as `Deploy.s.sol` did. Write the address into `contracts/deployments/16602.json` and `docs/evidence/faultline-registry-deploy.log` (address + tx).
- [ ] **Step 6:** Commit: `git commit -m "contracts: EpisodeRegistry (commit-before, finalize-after) deployed on Galileo"`.

### Task 10: TypeScript episode package: bundle, seal, publish, verify

**Files:**
- Create: `packages/episode/package.json` (`"name": "@sealedai/episode"`, deps `@0gfoundation/0g-compute-ts-sdk 0.9.0`, `crypto-js 4.2.0`, `circomlibjs 0.1.7`), `packages/episode/src/bundle.ts`, `packages/episode/src/publish.ts`, `packages/episode/src/verify.ts`, `packages/episode/src/cli.ts`, `packages/episode/test/bundle.test.ts`, `packages/episode/test/verify.test.ts`
- Modify: `packages/protocol/src/envelope.ts:9` (add `'episode'` to `ObjectType`), root `package.json` (workspace picks it up; add script `"faultline": "tsx packages/episode/src/cli.ts"`), `docs/TASKS.md` (change-log line for the ethers exception)

**Interfaces:**
- Consumes: `seal/open` from `packages/protocol/src/envelope.ts`, `packTar/unpackTar` from `tar.ts`, `canonical` from `canonical.ts`, `storage()` from `packages/integrations/src/storage.ts`.
- Produces in `bundle.ts`: `readRun(dir: string) -> Run` (`{manifest, scenario, decisions: Decision[], trajectory: unknown[], metrics, recorderPath?}`), `publicJson(run: Run) -> Uint8Array` = canonical JSON of `{manifest, decisions: decisions.map(d => ({cp, sim_time_s, action, control_decel_mps2, source, reason, model, request_id, provider, zg_res_key, latency_ms, observation_sha256: sha256(canonical(d.observation))})), trajectory, metrics, prompt_hash: manifest.prompt_hash}` (no `observation`, no `history`, no `content`, no `scenario`), `sealedTar(run: Run) -> Uint8Array` = deterministic tar of every file in the run dir, `sealRun(tar, key) -> Uint8Array` via `seal(tar, {objectType: 'episode', objectId: manifest.episode_id, version: 1}, key)`.
- Produces in `publish.ts`: `publish(dir, cfg: {rpcUrl, indexerUrl, privateKey, tenantKeyHex}) -> {publicRoot, publicTx, sealedRoot, sealedTx}` written to `dir/publish.json`.
- Produces in `verify.ts`: `verify(publicRoot: string, cfg: {rpcUrl, indexerUrl, mainnetRpc: 'https://evmrpc.0g.ai', tenantKeyHex?: string, sealedRoot?: string}) -> Verification` where `Verification = {publicRootOk, chainOk (log chain recomputed over the public decisions' hashes is NOT possible without observations → instead: every decision's observation_sha256 present and decisions count == manifest.decisions_total), metricsRecomputedOk (recompute ttc/thw/drac/ccs for every trajectory line from its lidar fields with the same formulas ported to TS, tolerance 1e-9), signatures: [{cp, request_id, provider, zg_res_key, verified: true|false|null}], sealed?: {opened: boolean, filesHashesMatchManifest: boolean, chainOk: boolean}}`; signature check = `broker.inference.processResponse(provider, zg_res_key)` with `ethers.Wallet.createRandom().connect(new JsonRpcProvider(mainnetRpc))`, catching errors as `null`. Writes `verification.json` next to the CLI's `--out`.
- CLI: `faultline publish <dir>`, `faultline verify <publicRoot> [--sealed <root> --key <hex>] [--out file]`; env from `.env` (`RPC_URL`, `STORAGE_INDEXER`, `PRIVATE_KEY`, `FAULTLINE_TENANT_KEY` (32-byte hex; generate with `openssl rand -hex 32` and add to `.env.example` as a placeholder)).

- [ ] **Step 1:** `bundle.test.ts` on a fixture run dir produced by `KinematicWorld` (check one into `packages/episode/test/fixtures/run-kinematic/`, generated by Task 6's test runner with a scripted decider): `publicJson` parses, has no key named `observation`, `history`, `content`, `scenario`, `salt`; `sealRun` then `open` with the right key round-trips the tar and `unpackTar` lists `manifest.json`; `open` with a different key throws; a flipped byte throws.
- [ ] **Step 2:** `verify.test.ts` (no network): `metricsRecomputedOk` true on the fixture and false after editing one `ccs` value; with a stub `processResponse` returning `[true, false, null]` the `signatures` array mirrors it.
- [ ] **Step 3:** Run `npm test`. Expected: new tests FAIL. **Step 4:** Implement (install deps with exact pins: `npm i -w packages/episode @0gfoundation/0g-compute-ts-sdk@0.9.0 crypto-js@4.2.0 circomlibjs@0.1.7`). **Step 5:** `npm test` PASS and `npm run typecheck` clean.
- [ ] **Step 6:** Live: `npm run faultline -- publish runs/demo-001` then `npm run faultline -- verify <publicRoot> --sealed <sealedRoot> --key $FAULTLINE_TENANT_KEY --out runs/demo-001/verification.json`. Expected: `publicRootOk true`, `metricsRecomputedOk true`, every `signatures[].verified === true` (if any is `false`, keep it and show it; do not retry the inference), `sealed.opened true`. Save roots and txs to `docs/evidence/faultline-publish-001.log`. Do the same for `runs/halt-001`.
- [ ] **Step 7:** Commit: `git commit -m "episode: public/sealed bundles on 0G Storage, independent signature verification"`.

### Task 11: Chain anchoring and the Python `--anchor` integration

**Files:**
- Create: `packages/episode/src/anchor.ts`, `packages/episode/src/abi/episodeRegistry.ts`
- Modify: `packages/episode/src/cli.ts` (`commit <dir>`, `finalize <dir>`), `faultline/cli.py` (`--anchor`), `faultline/episode.py` (manifest fields `commit_tx`, `finalize_tx`, `registry`)
- Test: `packages/episode/test/anchor.test.ts` (commitment math only), live evidence for the rest

**Interfaces:**
- Produces: `scenarioCommitment(scenarioJson: Uint8Array, salt: Hex) -> Hex` = `keccak256(encodeAbiParameters([bytes32, bytes32], [salt, sha256(scenarioJson)]))` (viem); `commit(dir, cfg) -> {episodeId, salt, commitment, tx}` written to `dir/anchor.json` (**salt stays in the sealed tar only**: `bundle.ts` must include `anchor.json` in the tar and exclude it from `publicJson`); `finalize(dir, cfg)` reads `publish.json` + `manifest.json`, `resultCommitment = keccak256(abi.encode(salt, sha256(metrics.json)))`, status `1|2`, `collision`, writes `tx` into `anchor.json`; `episodeId = 0x + manifest.episode_id`.
- Python: with `--anchor`, `cli.py` writes `scenario.json` + a preliminary `manifest.json` (episode_id, scenario_hash, started_at) **before** constructing the decider, runs `npm run -s faultline -- commit <dir>` via `subprocess.run(check=True)`, and only then starts the loop; after the loop it runs `publish` then `finalize`, and copies the three tx hashes and roots into `manifest.json`.

- [ ] **Step 1:** `anchor.test.ts`: `scenarioCommitment` equals `keccak256` of the hand-built abi encoding for a fixed salt and payload; `publicJson` of a run dir containing `anchor.json` has no `salt` string anywhere in its bytes.
- [ ] **Step 2:** FAIL → implement (viem `createWalletClient` pattern from `packages/integrations/src/chain.ts`, registry address from `contracts/deployments/16602.json`) → PASS.
- [ ] **Step 3:** Live end-to-end (paid: gas + cents): `.venv/bin/python -m faultline run --world carla --seed 7 --out runs/demo-002 --anchor`. Expected: `ScenarioCommitted` tx **before** the first `request_id` timestamp (compare block timestamp with the first decision's `wall_clock_utc` field; add that field to log entries if missing), `EpisodeFinalized` after; `getEpisode` returns the published roots; `verify` passes. Save everything to `docs/evidence/faultline-e2e-002.log`.
- [ ] **Step 4:** Commit: `git commit -m "episode: Galileo commit-before / finalize-after anchoring wired into the run"`.

### Task 12: Static verifier and replay page

**Files:**
- Create: `apps/faultline-web/index.html`, `apps/faultline-web/src/main.ts`
- Modify: root `package.json` scripts: `"fweb:build": "esbuild apps/faultline-web/src/main.ts --bundle --format=esm --platform=browser --target=es2022 --minify --sourcemap --outfile=apps/faultline-web/dist/app.js --external:fs --external:path --external:os --external:'node:*' --define:process.env.NODE_ENV='\"production\"' && cp apps/faultline-web/index.html apps/faultline-web/dist/index.html"`, `"fweb:serve": "python3 -m http.server 5174 -d apps/faultline-web/dist"`; `.gitignore` add `apps/faultline-web/dist/`
- Test: `tests/python/test_web_headless.py` using the pre-installed Playwright (`require('playwright')` works from Node; write it as `apps/faultline-web/test/headless.mjs` instead and run with `node`) — it serves `dist/`, opens the page, enters the fixture public JSON through a "paste JSON" fallback input, and asserts the decisions table has 28 rows and the badge text.

**Interfaces:**
- Consumes: `storage().downloadBlob(root)` (works in the browser; the SealedAI web app already bundles it), `verify.ts` pure parts (metrics recompute) — split `verify.ts` so `recomputeMetrics(trajectory)` and `checkPublic(json)` live in `packages/episode/src/check.ts` with no ethers import, and the page imports only `check.ts`.
- Page behaviour: inputs `public root`, `indexer URL` (default testnet turbo), optional `sealed root + tenant key` (opens with `open()` from `protocol/envelope.ts` in the browser, shows file hashes match); shows manifest (status, collision, model, trust mode, prompt hash, network labels "inference: 0G mainnet Router · storage/chain: 0G Galileo"), the decisions table (`cp, sim_time, action, source, reason, request_id, provider, latency`), the metrics card with `badge()` colour, a canvas chart of `gap` and `ttc` over time, a top-down 1-D animation of two rectangles replaying `trajectory.jsonl` with a play button, and links: `https://storagescan-galileo.0g.ai/...` for roots, `https://chainscan-galileo.0g.ai/tx/<hash>` for `commit_tx`/`finalize_tx`. Signature verification in the browser is **not** attempted (the Compute SDK bundle is heavy); the page shows the `verification.json` signatures if the public JSON carries a `verification` object (Task 10's publish embeds `verification.json` into the public JSON when present) and prints the CLI command to re-check.

- [ ] **Step 1:** Write `headless.mjs` test (fails: no dist). **Step 2:** Implement page + build. **Step 3:** `npm run fweb:build && node apps/faultline-web/test/headless.mjs`. Expected: `PASS` lines. **Step 4:** Open the real `runs/demo-002` public root in the page (headless screenshot `docs/evidence/faultline-web-demo-002.png` at deviceScaleFactor 2). **Step 5:** Commit.

### Task 13: Tenant isolation, fault matrix, evidence file

**Files:**
- Create: `tests/python/test_chaos_matrix.py`, `docs/evidence/faultline-matrix.md`
- Modify: `faultline/cli.py` (`--chaos` gains `timeout|garbage|r429|r502` using the Task 3 fake server started in-process on a random port; these are test modes and the CLI prints `CHAOS MODE: <mode> (fake router, test only)` in red and sets `manifest.chaos = mode` so a chaos run can never be mistaken for evidence)

- [ ] **Step 1:** `test_chaos_matrix.py`: for every chaos mode on `KinematicWorld`: status interrupted, exactly one `source none` entry, `manifest.chaos == mode`; `--chaos none` with the fake `ok` server: completed.
- [ ] **Step 2:** Tenant isolation (TS, extend `bundle.test.ts`): a second random key cannot open `runs/demo-002`'s sealed blob (download it live once, or use the local sealed bytes written by `publish` to `dir/sealed.bin`); the public JSON bytes contain none of: the scenario's `initial_gap_m` key, `"history"`, `"salt"`.
- [ ] **Step 3:** Write `docs/evidence/faultline-matrix.md`: the spec's T1–T11 table with the actual command, result line, request IDs, roots, tx hashes and dates. Any row not green stays red with the reason.
- [ ] **Step 4:** Commit.

### Task 14: README, submission assets, tracker

**Files:**
- Modify: `README.md` (rewrite for Faultline: what it is, the referee pitch in one paragraph (spec §12), setup from a fresh clone (CARLA path, `.venv`, `.env.example` keys, `npm ci`), run/replay/verify commands, evidence links, contract address, the honest limits list from spec §4 and §6, MBRDI attribution), `.env.example` (`FAULTLINE_TENANT_KEY`), `docs/TASKS.md` (mark the Faultline tasks and evidence; one change-log line: PLAN rev 4 = the Faultline spec), `docs/PLAN.md` (top banner: "Superseded for the hackathon by the Faultline spec; SealedAI rev 3 kept for reference")
- Create: `docs/demo-script.md` (3-minute video shot list: 1. referee pitch 20 s; 2. live run with the decisions table filling and CARLA spectator view 60 s; 3. pull the network → safe halt 25 s; 4. verifier page: root, signatures, replay animation, chain links 45 s; 5. limits 15 s)

- [ ] **Step 1:** Fresh-clone check: `git clone . /tmp/faultline-fresh && cd /tmp/faultline-fresh && npm ci && npm test && npm run typecheck && npm run fweb:build` and `.venv/bin/python -m pytest tests/python -q` from the repo. Expected: all green.
- [ ] **Step 2:** Commit, then push the branch: `git push -u origin build/faultline` (the user authorized the build; opening a PR is not requested).

---

## Self-review notes

- Spec coverage: §5.1 packages → Tasks 0–8, 10–12; §5.2 schemas → Tasks 2, 6; §5.4 loop steps 1–11 → Tasks 6, 7, 10, 11, 12; §5.5 state machine + retry policy → Tasks 3, 6, 13; §5.6/§6 claims → Tasks 10, 14; §5.7 inputs → Tasks 2, 6; §7 contract → Task 9; §10 matrix → Task 13; §12 pitch → Task 14. Discovery mode (§5.7 last paragraph, §5.8 item 2) is **not** in this plan: it is the first follow-up once Task 14 is green.
- Type consistency: `Decision` (Task 3) is what `FakeDecider`/`RecordedDecider` produce (Tasks 6, 8); `TickState` fields are the trajectory line fields (Tasks 5, 6, 10, 12); `publish.json`/`anchor.json` names are shared by Tasks 10–12.
- Review Focus items 1–5 are pinned in Tasks 3, 3, 4/6, 6, 10/13.
