# Ideas-agent model probes (2026-11-07): private tier only; prints trace fields and content, never the key.
# Usage: .venv/bin/python spikes/ideas_probe.py <probe-name>...   (names below); appends to docs/evidence/faultline-model-probes.log
import json, sys, time, datetime, hashlib
from pathlib import Path
import requests
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from faultline.cli import load_dotenv
from faultline import cutin
import os
load_dotenv()
BASE, KEY = os.environ["ZG_ROUTER_URL"].rstrip("/"), os.environ["ZG_API_KEY"]
LOG = Path(__file__).resolve().parent.parent / "docs/evidence/faultline-model-probes.log"
# cutin-001 cp3, verbatim observation + history: the model claimed "TTC below 1.0s and ego is slower" (ttc 1.141, ego 5.81 > adv 0)
CP3 = json.loads(Path("runs/cutin-001/decisions.jsonl").read_text().splitlines()[3])
USER = json.dumps({"history": CP3["history"], "observation": CP3["observation"]}, sort_keys=True, separators=(",", ":"))
AV = CP3["observation"]["available_actions"]

def post(path, body):
    h = {"Authorization": f"Bearer {KEY}", "X-0G-Provider-Trust-Mode": "private", "Content-Type": "application/json"}
    t = time.monotonic()
    try:
        r = requests.post(BASE + path, json=body, headers=h, timeout=120)
    except requests.RequestException as e:
        return None, {}, f"{type(e).__name__}", int((time.monotonic() - t) * 1000)
    ms = int((time.monotonic() - t) * 1000)
    try: j = r.json()
    except ValueError: j = {}
    return r, j, None, ms

def chat(model, system, user, thinking=False, json_mode=True, max_tokens=200, temperature=0, effort=None):
    body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature, "max_tokens": max_tokens, "chat_template_kwargs": {"enable_thinking": thinking}}
    if json_mode: body["response_format"] = {"type": "json_object"}
    if effort: body["reasoning_effort"] = effort
    return post("/chat/completions", body)

def record(name, model, r, j, err, ms, extra=None):
    tr = j.get("x_0g_trace") if isinstance(j.get("x_0g_trace"), dict) else {}
    msg = ((j.get("choices") or [{}])[0] or {}).get("message", {}) if isinstance(j.get("choices"), list) else {}
    rec = {"utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "probe": name, "model": model,
           "http": r.status_code if r is not None else None, "error": err or (j.get("error") if r is not None and r.status_code != 200 else None),
           "request_id": tr.get("request_id") or (r.headers.get("X-Request-Id") if r is not None else None),
           "provider": tr.get("provider"), "zg_res_key": r.headers.get("Zg-Res-Key") if r is not None else None,
           "latency_ms": ms, "usage": j.get("usage"), "content": msg.get("content"),
           "reasoning_chars": len(msg.get("reasoning_content") or msg.get("reasoning") or ""),
           "answers": j.get("answers"), **(extra or {})}
    with LOG.open("a") as f: f.write(json.dumps(rec, sort_keys=True) + "\n")
    print(json.dumps(rec, indent=1)[:1500])
    return rec

SWARM_SYS = None  # filled from faultline.swarm when present

def run(name):
    if name == "0gm-nothink":
        r, j, e, ms = chat("0gm-1.0-35b-a3b", cutin.SYSTEM_PROMPT, USER); record(name, "0gm-1.0-35b-a3b", r, j, e, ms)
    elif name == "0gm-think":
        r, j, e, ms = chat("0gm-1.0-35b-a3b", cutin.SYSTEM_PROMPT, USER, thinking=True, max_tokens=3000)
        record(name, "0gm-1.0-35b-a3b", r, j, e, ms)
    elif name == "sia-nothink":
        r, j, e, ms = chat("0gm-1.0-35b-a3b-sia", cutin.SYSTEM_PROMPT, USER, json_mode=False)
        record(name, "0gm-1.0-35b-a3b-sia", r, j, e, ms)
    elif name == "sia-think":
        r, j, e, ms = chat("0gm-1.0-35b-a3b-sia", cutin.SYSTEM_PROMPT, USER, thinking=True, json_mode=False, max_tokens=3000)
        record(name, "0gm-1.0-35b-a3b-sia", r, j, e, ms)
    elif name == "glm-nothink":
        r, j, e, ms = chat("glm-5.3", cutin.SYSTEM_PROMPT, USER, json_mode=False)
        record(name, "glm-5.3", r, j, e, ms)
    elif name in ("laya", "vela"):
        model = "laya" if name == "laya" else "vela-2.0-9b"
        crit = {"KEEP_LANE": "hold speed", "ACCELERATE": "+1.5 m/s2", "SLOW_DOWN": "-2.5 m/s2",
                "BRAKE_HARD": "-6 m/s2, only when ego TTC >= 1 s or ego already slower than you"}
        body = {"model": model, "state": USER, "verify_tee": True, "questions": {"maneuver": {"type": "choice",
                "instructions": "Pick the adversary action for the next 1 s that is most demanding for the ego while leaving an escape.",
                "criteria": {k: v for k, v in crit.items() if k in AV}}}}
        r, j, e, ms = post("/decisions", body); record(name, model, r, j, e, ms)
    elif name.startswith("swarm"):
        from faultline import swarm
        obs = json.loads(Path(sys.argv[2]).read_text()) if len(sys.argv) > 2 else swarm.example_observation()
        think = name == "swarm-think"
        r, j, e, ms = chat("0gm-1.0-35b-a3b", swarm.SYSTEM_PROMPT, json.dumps({"history": [], "observation": obs}),
                           thinking=think, max_tokens=3000 if think else 200)
        rec = record(name, "0gm-1.0-35b-a3b", r, j, e, ms)
        print("parsed:", swarm.parse_joint(rec["content"] or "", swarm.available_map(obs)))
    elif name == "critic":
        # planner proposal from cutin-001 cp3 + our own forecast of each candidate (kinematic, constant ego speed)
        o = CP3["observation"]
        cands = {}
        for a in AV:
            acc = cutin.action_accel(a, cutin.CutInScenario(seed=0))
            va = max(o["adversary_speed_mps"] + acc, 0.0)
            gap1 = o["gap_m"] + (o["adversary_speed_mps"] + va) / 2 - o["ego_speed_mps"]
            cands[a] = {"gap_after_1s_if_ego_holds_speed_m": round(gap1, 2), "adv_speed_after_1s": va}
        user = json.dumps({"observation": o, "proposal": {"action": CP3["action"], "why": json.loads(CP3["content"])["why"]},
                           "forecast": cands})
        sys_c = ("You audit an adversary's proposed maneuver in an automated-driving test. The rule: never brake hard in "
                 "the ego's lane when ttc_s is below 1.0 s unless ego_speed_mps <= adversary_speed_mps; never pick an "
                 "action whose forecast gap is <= 0 while the ego holds speed. Check the proposal's stated facts against the "
                 "observation. Reply JSON only: {\"verdict\": \"ACCEPT\"|\"REVISE\", \"action\": \"<one of available_actions>\", "
                 "\"facts_wrong\": \"<=20 words\"}.")
        r, j, e, ms = chat("0gm-1.0-35b-a3b", sys_c, user); record(name, "0gm-1.0-35b-a3b", r, j, e, ms, {"forecast": cands})

for n in sys.argv[1:2] if len(sys.argv) > 1 and sys.argv[1].startswith("swarm") else sys.argv[1:]:
    run(n)
