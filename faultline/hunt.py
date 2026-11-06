"""Autonomous failure hunter / safety boundary mapper.

python -m faultline.hunt ground-truth | run --goal g1|g2 | bench | minimize --from <hunt.json> | carla <run_dir>

Four experiment designers share one budget and one runner (faultline/experiment.py): (A) fixed grid, (B) seeded
random, (C) per-delay bisection on gap (knows monotonicity), (D) 0G (faultline/designer.py). Safety definition
everywhere: safe = no collision AND min gap >= 2.0 m.
"""
import argparse
import hashlib
import json
import os
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from faultline.config import canonical
from faultline.designer import FINAL_PROMPT, SYSTEM_PROMPT, Designer, parse_final, parse_turn, prompt_hashes
from faultline.experiment import SAFETY_DEFINITION, SPACE, run_experiment, validate
from faultline.log import ChainLog

ROOT = Path(__file__).resolve().parent.parent
GT_PATH = ROOT / "runs" / "hunt-groundtruth.json"
SCORE_DELAYS = (0.3, 0.6, 0.9, 1.2, 1.5)
WORLD_NOTE = ("Both cars start at ego_speed_mps, initial_gap_m apart (bumper to bumper). The ego's controller is tuned "
              "to follow at that gap. The lead holds its speed until brake_onset_s, then brakes at lead_decel_mps2 "
              "(capped by the road at 0.8*9.81*friction_mu) until it stops. The ego only reacts after "
              "reaction_delay_s. A run ends when both cars have stood still for 1 s, at a collision, or at 30 s.")

# G1 deviates from the brief's 25 m/s: at 25 m/s this controller needs > 80 m (outside the frozen range) for every
# delay >= 0.9 s, so the boundary would not exist in range (see docs/evidence/faultline-hunt.md).
G1 = {"id": "g1", "budget": 24,
      "text": "Find the minimum safe following distance for this controller at 15 m/s on dry road (mu 0.8) when the "
              "lead brakes at 6 m/s^2 (brake onset at t = 5 s), as a function of the ego's reaction delay over "
              "0.3-1.5 s. Budget: 24 experiments. Prioritize informative trials.",
      "fixed": {"ego_speed_mps": 15.0, "friction_mu": 0.8, "lead_decel_mps2": 6.0, "brake_onset_s": 5.0},
      "ranges": {"initial_gap_m": (5.0, 80.0), "reaction_delay_s": (0.3, 1.5)}}
G2 = {"id": "g2", "budget": 16,
      "text": "Check whether this vehicle becomes unsafe when the lead brakes hard on a low-friction road; find the "
              "conditions that matter most. Budget 16.",
      "fixed": {}, "ranges": dict(SPACE)}
GOALS = {"g1": G1, "g2": G2}
OUTCOME_KEYS = ("safe", "collision", "min_gap_m", "min_ttc_s", "max_drac_mps2", "ccs", "ego_max_decel_mps2",
                "measured_reaction_s", "lead_decel_applied_mps2", "lead_decel_clamped")


def _sha_file(p: Path) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def off_goal(p: dict, goal: dict) -> str | None:
    for k, v in goal["fixed"].items():
        if abs(float(p[k]) - v) > 1e-9:
            return f"{k}={p[k]} but the goal fixes {v}"
    for k, (lo, hi) in goal["ranges"].items():
        if not lo <= p[k] <= hi:
            return f"{k}={p[k]} outside the goal's [{lo}, {hi}]"
    return None


def execute(goal: dict, params) -> dict:
    """Validate, then run. Invalid and off-goal proposals are not run but still cost one experiment."""
    reason = validate(params)
    if reason:
        return {"params": params, "status": "invalid", "reason": reason, "outcome": None}
    reason = off_goal(params, goal)
    if reason:
        return {"params": params, "status": "off_goal", "reason": reason, "outcome": None}
    return {"params": {k: float(params[k]) for k in SPACE}, "status": "ran", "reason": None,
            "outcome": run_experiment(params)}


# ---------------------------------------------------------------- classical designers: propose(history) -> params
def _point(goal, gap, delay):
    return {**goal["fixed"], "initial_gap_m": round(float(gap), 4), "reaction_delay_s": round(float(delay), 4)}


def grid(goal):
    (g0, g1), (d0, d1) = goal["ranges"]["initial_gap_m"], goal["ranges"]["reaction_delay_s"]
    pts = [_point(goal, g, d) for d in np.linspace(d0, d1, 6) for g in np.linspace(g0, g1, 4)]
    return lambda hist: pts[len(hist) % len(pts)]


def random_sampler(goal, seed=0):
    rng = random.Random(seed)

    def propose(hist):
        return {k: goal["fixed"][k] if k in goal["fixed"] else round(rng.uniform(*goal["ranges"][k]), 4) for k in SPACE}
    return propose


def _bracket(hist, delay, lo, hi):
    """Tightest (largest unsafe, smallest safe) gap tested at this delay; the range ends stand in when none."""
    ran = [e for e in hist if e["status"] == "ran" and abs(e["params"]["reaction_delay_s"] - delay) < 1e-9]
    unsafe = [e["params"]["initial_gap_m"] for e in ran if not e["outcome"]["safe"]]
    safe = [e["params"]["initial_gap_m"] for e in ran if e["outcome"]["safe"]]
    return max(unsafe, default=lo), min(safe, default=hi)


def bisection(goal, delays=SCORE_DELAYS):
    lo, hi = goal["ranges"]["initial_gap_m"]

    def propose(hist):
        d = delays[len(hist) % len(delays)]  # round-robin, so any budget spreads evenly over the delays
        u, s = _bracket(hist, d, lo, hi)
        return _point(goal, (u + s) / 2, d)
    return propose


def estimate_classical(goal, hist) -> list[dict]:
    lo, hi = goal["ranges"]["initial_gap_m"]
    delays = sorted({e["params"]["reaction_delay_s"] for e in hist if e["status"] == "ran"})
    return [{"reaction_delay_s": d, "min_safe_gap_m": sum(_bracket(hist, d, lo, hi)) / 2} for d in delays]


def run_method(name, goal, propose, budget=None) -> dict:
    hist, t0 = [], time.monotonic()
    for _ in range(budget or goal["budget"]):
        e = execute(goal, propose(hist))
        hist.append({"n": len(hist) + 1, **e})
    return {"method": name, "status": "completed", "experiments": hist, "wall_s": round(time.monotonic() - t0, 3),
            "inference_calls": 0, "tokens": None, "estimate": estimate_classical(goal, hist) if goal["id"] == "g1" else None}


# ---------------------------------------------------------------- 0G designer
def _row(e):
    r = {"n": e["n"], **e["params"]} if isinstance(e["params"], dict) else {"n": e["n"], "params": e["params"]}
    if e["status"] != "ran":
        return {**r, "result": f"{e['status']}: {e['reason']} (not run)"}
    return {**r, **{k: e["outcome"][k] for k in OUTCOME_KEYS}}


def _user_msg(goal, hist, remaining):
    return {"goal": goal["text"], "parameter_space": {k: list(v) for k, v in SPACE.items()},
            "fixed_by_goal": goal["fixed"], "goal_ranges": {k: list(v) for k, v in goal["ranges"].items()},
            "safety_definition": SAFETY_DEFINITION, "world": WORLD_NOTE, "history": [_row(e) for e in hist],
            "remaining_budget": remaining}


def run_designer(goal, designer: Designer, log: ChainLog, budget=None, on_step=None) -> dict:
    budget = budget or goal["budget"]
    hist, hyps, calls, t0 = [], [], [], time.monotonic()
    out = {"method": "D-0G", "status": "completed", "reason": None, "final": None}

    def call(kind, system, user, parse, max_tokens=None):
        rec = designer.call(system, user, max_tokens)
        obj, why = (None, rec["error"]) if rec["error"] else parse(rec["content"])
        calls.append(rec)
        entry = {"kind": kind, "goal": goal["id"], "turn": len(hist) + 1 if kind == "turn" else None, "source": "0g",
                 **rec, "parse": why if obj is None else "ok", "parsed": obj}
        return obj, why, entry

    while len(hist) < budget:
        obj, why, entry = call("turn", SYSTEM_PROMPT, _user_msg(goal, hist, budget - len(hist)), parse_turn)
        if obj is None:
            log.append({**entry, "validity": None, "outcome": None})
            out.update(status="halted", reason=f"turn {len(hist) + 1}: {why}")
            break
        e = {"n": len(hist) + 1, **execute(goal, obj["experiment"])}
        hist.append(e)
        hyps.append({"n": e["n"], "hypothesis": obj["hypothesis"], "why": obj["why"], "request_id": entry["request_id"]})
        log.append({**entry, "experiment": obj["experiment"], "validity": e["status"], "invalid_reason": e["reason"],
                    "outcome": e["outcome"]})
        if on_step:
            on_step(hist)
    if out["status"] == "completed":
        user = {**_user_msg(goal, hist, 0), "hypotheses": hyps}
        obj, why, entry = call("final", FINAL_PROMPT, user, parse_final, designer.final_max_tokens)
        log.append({**entry, "validity": None, "outcome": None})
        if obj is None:
            out.update(status="halted", reason=f"final report: {why}")
        out["final"] = obj
    usage = [c["usage"] for c in calls if c["usage"]]
    return {**out, "experiments": hist, "hypotheses": hyps, "wall_s": round(time.monotonic() - t0, 3),
            "inference_calls": len(calls), "request_ids": [c["request_id"] for c in calls if c["request_id"]],
            "latency_ms": [c["latency_ms"] for c in calls],
            "tokens": {k: sum(u.get(k) or 0 for u in usage) for k in ("prompt_tokens", "completion_tokens")} if usage else None,
            "cost_usd": round(sum(c.get("cost_usd") or 0 for c in calls), 6),
            "estimate": [b for b in (out["final"] or {}).get("boundary", []) if b["min_safe_gap_m"] is not None]
            if goal["id"] == "g1" and out["final"] else None}


# ---------------------------------------------------------------- ground truth and scoring
def _gt_key(goal):
    return hashlib.sha256(canonical({"goal": goal["fixed"], "ranges": goal["ranges"],
                                     "experiment": _sha_file(ROOT / "faultline/experiment.py"),
                                     "controller": _sha_file(ROOT / "faultline/controller.py"),
                                     "world": _sha_file(ROOT / "faultline/world.py")}).encode()).hexdigest()


def boundary_at(goal, delay, res=0.25, scan_step=1.0) -> dict:
    """Bisection on gap to `res`, plus a full scan at `scan_step` that reports any safe -> unsafe flip as gap grows."""
    lo, hi = goal["ranges"]["initial_gap_m"]
    safe = lambda g: run_experiment(_point(goal, g, delay))["safe"]
    scan = [(g, safe(g)) for g in np.arange(lo, hi + 1e-9, scan_step)]
    flips = [round(float(a[0]), 3) for a, b in zip(scan, scan[1:]) if a[1] and not b[1]]
    if safe(lo):
        return {"reaction_delay_s": delay, "min_safe_gap_m": lo, "estimate_m": lo, "monotone": not flips, "flips": flips}
    if not safe(hi):
        return {"reaction_delay_s": delay, "min_safe_gap_m": None, "estimate_m": None, "monotone": not flips, "flips": flips}
    while hi - lo > res:
        mid = (lo + hi) / 2
        lo, hi = (lo, mid) if safe(mid) else (mid, hi)
    return {"reaction_delay_s": delay, "min_safe_gap_m": round(hi, 4), "estimate_m": round((lo + hi) / 2, 4),
            "monotone": not flips, "flips": flips}


def ground_truth(goal=G1, path=GT_PATH, refresh=False) -> dict:
    key = _gt_key(goal)
    if path.exists() and not refresh:
        gt = json.loads(path.read_text())
        if gt.get("key") == key:
            return gt
    t0 = time.monotonic()
    delays = sorted({round(0.3 + 0.05 * i, 2) for i in range(25)} | set(SCORE_DELAYS))
    rows = [boundary_at(goal, d) for d in delays]
    gt = {"schema": "faultline.hunt-groundtruth/v1", "key": key, "goal": goal["id"], "resolution_m": 0.25,
          "scan_step_m": 1.0, "safety_definition": SAFETY_DEFINITION, "rows": rows,
          "monotone_all": all(r["monotone"] for r in rows), "wall_s": round(time.monotonic() - t0, 2)}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(gt, indent=1) + "\n")
    return gt


def _interp(est, delays):
    est = sorted((b["reaction_delay_s"], b["min_safe_gap_m"]) for b in est)
    return np.interp(delays, [d for d, _ in est], [g for _, g in est]) if est else None


def score(res: dict, gt: dict) -> dict:
    hist = res["experiments"]
    unsafe = [e for e in hist if e["status"] == "ran" and not e["outcome"]["safe"]]
    truth = {r["reaction_delay_s"]: r["estimate_m"] for r in gt["rows"]}
    est = _interp(res["estimate"] or [], SCORE_DELAYS) if res.get("estimate") else None
    errs = [abs(float(e) - truth[d]) for d, e in zip(SCORE_DELAYS, est)] if est is not None else None
    return {"method": res["method"], "status": res["status"], "mae_m": round(sum(errs) / len(errs), 3) if errs else None,
            "abs_err_m": [round(x, 3) for x in errs] if errs else None,
            "estimate_at_score_delays": [round(float(x), 3) for x in est] if est is not None else None,
            "first_unsafe_at": unsafe[0]["n"] if unsafe else None,
            "distinct_unsafe": len({canonical(e["params"]) for e in unsafe}),
            "invalid": sum(e["status"] == "invalid" for e in hist), "off_goal": sum(e["status"] == "off_goal" for e in hist),
            "experiments": len(hist), "wall_s": res["wall_s"], "inference_calls": res["inference_calls"],
            "tokens": res["tokens"]}


# ---------------------------------------------------------------- failure minimizer
BENIGN = {"friction_mu": 0.8, "reaction_delay_s": 0.6, "lead_decel_mps2": 3.0, "initial_gap_m": 40.0, "ego_speed_mps": 15.0}


def minimize(p: dict, run=run_experiment, steps=5, benign: dict | None = None) -> dict:
    """Delta-debug an unsafe case toward BENIGN, one parameter at a time: restore it fully if still unsafe, else
    bisect toward the benign value and keep the closest still-unsafe value. A factor is necessary when restoring it
    alone (in the minimized case) makes the run safe; that counterfactual run is the evidence."""
    benign = BENIGN if benign is None else benign  # research.py drops the keys a goal fixes
    runs = []

    def unsafe(q):
        o = run(q)
        runs.append({"params": q, "safe": o["safe"], "min_gap_m": o.get("min_gap_m"), "collision": o.get("collision")})
        return not o["safe"]

    cur = {k: float(v) for k, v in p.items()}
    assert unsafe(cur), "minimize needs an unsafe start"
    for _ in range(3):  # passes until no parameter can be fully restored
        restored = False
        for k, b in benign.items():
            if cur[k] == b:
                continue
            if unsafe({**cur, k: b}):
                cur, restored = {**cur, k: b}, True
                continue
            bad, good = cur[k], b
            for _ in range(steps):
                mid = round((bad + good) / 2, 4)
                bad, good = (mid, good) if unsafe({**cur, k: mid}) else (bad, mid)
            cur = {**cur, k: bad}
        if not restored:
            break
    necessary = []
    for k, b in benign.items():
        if cur[k] != b:
            q = {**cur, k: b}
            o = run(q)
            necessary.append({"factor": k, "failing_value": cur[k], "benign_value": b, "counterfactual_params": q,
                              "counterfactual_safe": o["safe"], "counterfactual_min_gap_m": o.get("min_gap_m")})
    return {"start": p, "minimal_failing_case": cur, "minimal_outcome": run(cur), "necessary": necessary,
            "restored": [k for k in benign if cur[k] == benign[k] and float(p[k]) != benign[k]],
            "runs": len(runs), "trace": runs}


# ---------------------------------------------------------------- SVG
def svg(goal, gt, res, title, upto=None) -> str:
    W, H, L, R, T, B = 720, 460, 60, 20, 40, 50
    (g0, g1), (d0, d1) = (0.0, 85.0), (0.2, 1.6)
    X = lambda d: L + (d - d0) / (d1 - d0) * (W - L - R)
    Y = lambda g: H - B - (g - g0) / (g1 - g0) * (H - T - B)
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="sans-serif" font-size="12">',
         f'<rect width="{W}" height="{H}" fill="#fff"/>', f'<text x="{L}" y="22" font-size="15">{title}</text>']
    for g in range(0, 81, 10):
        o.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(g):.1f}" y2="{Y(g):.1f}" stroke="#eee"/>'
                 f'<text x="{L - 8}" y="{Y(g) + 4:.1f}" text-anchor="end" fill="#555">{g}</text>')
    for i in range(3, 16, 3):
        d = i / 10
        o.append(f'<line y1="{T}" y2="{H - B}" x1="{X(d):.1f}" x2="{X(d):.1f}" stroke="#eee"/>'
                 f'<text x="{X(d):.1f}" y="{H - B + 18}" text-anchor="middle" fill="#555">{d:.1f}</text>')
    o.append(f'<text x="{(L + W) / 2}" y="{H - 10}" text-anchor="middle">reaction delay (s)</text>'
             f'<text x="16" y="{(T + H) / 2}" transform="rotate(-90 16 {(T + H) / 2})" text-anchor="middle">initial gap (m)</text>')
    if gt:
        pts = " ".join(f"{X(r['reaction_delay_s']):.1f},{Y(r['estimate_m']):.1f}" for r in gt["rows"] if r["estimate_m"] is not None)
        o.append(f'<polyline points="{pts}" fill="none" stroke="#222" stroke-width="2"/>'
                 f'<text x="{W - R - 4}" y="{T + 14}" text-anchor="end">— ground truth (safe above)</text>')
    est = res.get("estimate") if upto is None else None
    if est:
        pts = " ".join(f"{X(b['reaction_delay_s']):.1f},{Y(b['min_safe_gap_m']):.1f}" for b in sorted(est, key=lambda b: b["reaction_delay_s"]))
        o.append(f'<polyline points="{pts}" fill="none" stroke="#1f6feb" stroke-width="2" stroke-dasharray="6 4"/>'
                 f'<text x="{W - R - 4}" y="{T + 30}" text-anchor="end" fill="#1f6feb">- - estimated boundary</text>')
    for e in res["experiments"][:upto]:
        p = e["params"] if isinstance(e["params"], dict) else {}
        try:
            x, y = X(float(p["reaction_delay_s"])), Y(min(max(float(p["initial_gap_m"]), g0), g1))
        except (KeyError, TypeError, ValueError):
            x, y = L + 10 + 14 * (e["n"] % 20), T + 10
        if e["status"] != "ran":
            o.append(f'<text x="{x:.1f}" y="{y + 5:.1f}" text-anchor="middle" font-size="16" fill="#999">×</text>')
        else:
            c = "#2da44e" if e["outcome"]["safe"] else "#cf222e"
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{c}"/>')
        o.append(f'<text x="{x + 7:.1f}" y="{y - 6:.1f}" font-size="10" fill="#333">{e["n"]}</text>')
    o.append("</svg>")
    return "\n".join(o)


def progress_video(out: Path) -> str:
    """step-NN.svg -> progress.mp4 when an SVG rasterizer is installed (nothing is installed here)."""
    tool = shutil.which("rsvg-convert") or shutil.which("convert")
    steps = sorted((out / "progress").glob("step-*.svg"))
    if not tool or not steps:
        return f"skipped: {'no rsvg-convert/convert installed' if not tool else 'no steps'}"
    for s in steps:
        png = s.with_suffix(".png")
        subprocess.run([tool, str(s), "-o", str(png)] if tool.endswith("rsvg-convert") else [tool, str(s), str(png)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "1", "-i", str(out / "progress/step-%02d.png"),
                    "-pix_fmt", "yuv420p", "-vf", "scale=720:-2", str(out / "progress.mp4")], check=True)
    return "progress.mp4"


# ---------------------------------------------------------------- CLI
def _designer(a) -> Designer:
    from faultline.cli import load_dotenv
    load_dotenv()
    url, key = os.environ.get("ZG_ROUTER_URL"), os.environ.get("ZG_API_KEY")
    if not url or not key:
        sys.exit("ZG_ROUTER_URL and ZG_API_KEY must be set in .env")
    return Designer(url, key, thinking=a.thinking)


def _out(a, tag):
    out = Path(a.out or ROOT / "runs" / f"hunt-{tag}-{time.strftime('%Y%m%dT%H%M%S')}")
    if out.exists() and any(out.iterdir()):
        sys.exit(f"refusing to overwrite {out}")
    out.mkdir(parents=True, exist_ok=True)
    return out


def _live(msg):
    with (ROOT / "runs" / "agent-live.log").open("a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} [hunt-agent] {msg}\n")


def _designer_run(goal, a, out, gt=None, budget=None):
    log = ChainLog(out / "designer.jsonl")
    (out / "progress").mkdir(exist_ok=True)
    step = lambda hist: (out / "progress" / f"step-{len(hist):02d}.svg").write_text(
        svg(goal, gt, {"experiments": hist}, f"0G designer, {goal['id']}: after experiment {len(hist)}"))
    res = run_designer(goal, _designer(a), log, budget=budget, on_step=step)
    res["log_head"] = log.head
    for h in res["hypotheses"]:
        e = res["experiments"][h["n"] - 1]
        tag = e["status"] if e["status"] != "ran" else ("safe" if e["outcome"]["safe"] else "UNSAFE")
        print(f"  #{h['n']:>2} {tag:<8} {canonical(e['params'])[:110]}\n       H: {h['hypothesis']}")
    print(f"0G status {res['status']} {res['reason'] or ''}  calls {res['inference_calls']}  wall {res['wall_s']} s")
    return res


def _manifest(out, a, extra):
    files = {p.name: _sha_file(p) for p in sorted(out.iterdir()) if p.is_file() and p.name != "manifest.json"}
    git = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    m = {"schema": "faultline.hunt/v1", "git_commit": git, "model": "0gm-1.0-35b-a3b", "trust_mode": "private",
         "thinking": a.thinking, "prompt_sha256": prompt_hashes(), "experiment_sha256": _sha_file(ROOT / "faultline/experiment.py"),
         "safety_definition": SAFETY_DEFINITION, "files": files, **extra}
    (out / "manifest.json").write_text(json.dumps(m, indent=2, sort_keys=True) + "\n")
    from faultline import ledger
    ledger.record(out)  # performance ledger (runs/ only)


def _fmt(x, nd=2):
    return "—" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))


def report_md(goal, rows, d, gt, verdict, extra="") -> str:
    L = [f"# Faultline hunt — {goal['id'].upper()}", "", f"Goal: {goal['text']}", "", f"Safety: {SAFETY_DEFINITION}.", ""]
    if rows:
        L += ["| method | status | boundary MAE (m) | first unsafe at | distinct unsafe | invalid | off-goal | wall (s) | inference calls | tokens (prompt/completion) |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        for r in rows:
            tok = f"{r['tokens']['prompt_tokens']}/{r['tokens']['completion_tokens']}" if r["tokens"] else "—"
            L.append(f"| {r['method']} | {r['status']} | {_fmt(r['mae_m'])} | {_fmt(r['first_unsafe_at'])} | {r['distinct_unsafe']} | "
                     f"{r['invalid']} | {r['off_goal']} | {_fmt(r['wall_s'])} | {r['inference_calls']} | {tok} |")
        L += ["", "Boundary at delays " + ", ".join(map(str, SCORE_DELAYS)) + " s (m):", "",
              "| | " + " | ".join(map(str, SCORE_DELAYS)) + " |", "|---|" + "---|" * len(SCORE_DELAYS)]
        truth = {r["reaction_delay_s"]: r["estimate_m"] for r in gt["rows"]}
        L.append("| ground truth | " + " | ".join(_fmt(truth[x]) for x in SCORE_DELAYS) + " |")
        for r in rows:
            L.append(f"| {r['method']} | " + " | ".join(_fmt(v) for v in (r["estimate_at_score_delays"] or [None] * 5)) + " |")
        L.append("")
    if d:
        L += ["## 0G turns", ""]
        for h in d["hypotheses"]:
            e = d["experiments"][h["n"] - 1]
            tag = e["status"] if e["status"] != "ran" else ("safe" if e["outcome"]["safe"] else "**unsafe**")
            res = f"min gap {e['outcome']['min_gap_m']} m, collision {e['outcome']['collision']}" if e["outcome"] else e["reason"]
            L.append(f"{h['n']}. `{canonical(e['params'])}` → {tag} ({res}); request `{h['request_id']}`  \n   "
                     f"*Hypothesis:* {h['hypothesis']}  \n   *Why:* {h['why']}")
        L += ["", "## 0G final report", "", "```json", json.dumps(d["final"], indent=1) if d["final"] else f"none ({d['reason']})", "```", ""]
    L += ["## Verdict", "", verdict, "", extra]
    return "\n".join(L) + "\n"


def verdict_text(rows) -> str:
    ok = [r for r in rows if r["mae_m"] is not None]
    if not ok:
        return "No method produced a boundary estimate."
    best = min(ok, key=lambda r: r["mae_m"])
    d = next((r for r in rows if r["method"] == "D-0G"), None)
    s = f"Most accurate boundary on the same budget: **{best['method']}** (MAE {best['mae_m']:.2f} m). "
    if d is None or d["mae_m"] is None:
        return s + f"The 0G designer produced no scored boundary (status {d and d['status']})."
    rank = sorted(ok, key=lambda r: r["mae_m"]).index(d) + 1
    s += f"The 0G designer ranks {rank}/{len(ok)} (MAE {d['mae_m']:.2f} m) and needs {d['inference_calls']} paid inference calls and {d['wall_s']:.0f} s wall time; the classical methods need none and run in well under a second. "
    if best["method"] != "D-0G":
        s += (f"On this one-dimensional, monotone boundary the 0G designer does not beat {best['method']}; its value here is "
              "turning the natural-language goal into valid experiments, explaining each choice and writing the report, not search efficiency.")
    else:
        s += "Here the 0G designer was the most accurate; one run, one seed, so treat it as a single observation."
    return s


def cmd_ground_truth(a) -> int:
    gt = ground_truth(G1, refresh=a.refresh)
    for r in gt["rows"]:
        if r["reaction_delay_s"] in SCORE_DELAYS:
            print(f"delay {r['reaction_delay_s']:.2f} s  min safe gap {r['min_safe_gap_m']}  estimate {r['estimate_m']}  monotone {r['monotone']} {r['flips'] or ''}")
    print(f"monotone_all {gt['monotone_all']}  rows {len(gt['rows'])}  cached {GT_PATH}")
    return 0


def cmd_bench(a) -> int:
    out = _out(a, "bench")
    gt = ground_truth(G1)
    results = [run_method("A-grid", G1, grid(G1)), run_method("B-random", G1, random_sampler(G1, a.seed)),
               run_method("C-bisection", G1, bisection(G1))]
    for r in results:
        (out / f"boundary-{r['method']}.svg").write_text(svg(G1, gt, r, f"{r['method']} on G1 ({len(r['experiments'])} experiments)"))
    d = _designer_run(G1, a, out, gt)
    results.append(d)
    (out / "boundary.svg").write_text(svg(G1, gt, d, f"0G designer on G1 ({len(d['experiments'])} experiments, {d['status']})"))
    (out / f"boundary-{d['method']}.svg").write_text((out / "boundary.svg").read_text())
    vid = progress_video(out)
    rows = [score(r, gt) for r in results]
    verdict = verdict_text(rows)
    (out / "bench.json").write_text(json.dumps({"goal": G1, "scores": rows, "verdict": verdict, "progress_video": vid}, indent=1) + "\n")
    (out / "hunt.json").write_text(json.dumps({"goal": G1, "ground_truth": gt, "results": results, "scores": rows,
                                               "safety_definition": SAFETY_DEFINITION, "space": SPACE}, indent=1) + "\n")
    (out / "report.md").write_text(report_md(G1, rows, d, gt, verdict, f"Progress video: {vid}."))
    _manifest(out, a, {"goal": "g1", "designer_log_head": d["log_head"], "designer_status": d["status"],
                       "groundtruth_key": gt["key"], "random_seed": a.seed})
    print(json.dumps(rows, indent=1))
    print(verdict)
    _live(f"bench G1 done: {out.name}; " + "; ".join(f"{r['method']} MAE {r['mae_m']}" for r in rows))
    return 0


def summarize_unsafe(res) -> dict:
    ran = [e for e in res["experiments"] if e["status"] == "ran"]
    uns = [e for e in ran if not e["outcome"]["safe"]]
    return {"ran": len(ran), "unsafe": len(uns), "invalid_or_off_goal": len(res["experiments"]) - len(ran),
            "unsafe_cases": [{"n": e["n"], **e["params"], "min_gap_m": e["outcome"]["min_gap_m"],
                              "collision": e["outcome"]["collision"]} for e in uns]}


def cmd_run(a) -> int:
    goal = GOALS[a.goal]
    out = _out(a, a.goal)
    gt = ground_truth(G1) if a.goal == "g1" else None
    d = _designer_run(goal, a, out, gt, budget=a.budget)
    (out / "boundary.svg").write_text(svg(goal, gt, d, f"0G designer on {goal['id']} ({d['status']})"))
    vid = progress_video(out)
    data = {"goal": goal, "results": [d], "safety_definition": SAFETY_DEFINITION, "space": SPACE}
    extra = f"Progress video: {vid}."
    rows = []
    if a.goal == "g1" and d["status"] == "completed":
        rows = [score(d, gt)]
    if a.goal == "g2":  # qualitative contrast only: random sampling on the same budget (no ground truth)
        rnd = run_method("B-random", goal, random_sampler(goal, a.seed), budget=a.budget)
        data["results"].append(rnd)
        data["comparison"] = {"D-0G": summarize_unsafe(d), "B-random": summarize_unsafe(rnd)}
        extra += "\n\n## Random sampling on the same budget (qualitative)\n\n```json\n" + json.dumps(data["comparison"], indent=1) + "\n```\n"
    data["scores"] = rows
    (out / "hunt.json").write_text(json.dumps(data, indent=1) + "\n")
    (out / "report.md").write_text(report_md(goal, rows, d, gt, f"0G status {d['status']} ({d['reason'] or 'ok'}).", extra))
    _manifest(out, a, {"goal": a.goal, "designer_log_head": d["log_head"], "designer_status": d["status"], "budget": a.budget or goal["budget"]})
    _live(f"run {a.goal} done: {out.name} status {d['status']} calls {d['inference_calls']}")
    return 0


def cmd_minimize(a) -> int:
    if a.params:
        p = json.loads(a.params)
    else:
        h = json.loads(Path(a.src).read_text())
        exps = [e for r in h["results"] for e in r["experiments"] if r["method"] == a.method]
        uns = [e for e in exps if e["status"] == "ran" and not e["outcome"]["safe"]]
        if not uns:
            sys.exit("no unsafe experiment to minimize")
        p = (next(e for e in uns if e["n"] == a.index) if a.index else uns[0])["params"]
    m = minimize(p)
    out = Path(a.out) if a.out else (Path(a.src).parent / "minimize.json" if a.src else ROOT / "runs" / "hunt-minimize.json")
    out.write_text(json.dumps(m, indent=1) + "\n")
    print(json.dumps({k: m[k] for k in ("start", "minimal_failing_case", "restored", "runs")}, indent=1))
    for n in m["necessary"]:
        print(f"necessary {n['factor']}: {n['failing_value']} (benign {n['benign_value']}) -> restoring it alone: "
              f"safe {n['counterfactual_safe']}, min gap {n['counterfactual_min_gap_m']} m")
    _live(f"minimize: {len(m['necessary'])} necessary factors {[n['factor'] for n in m['necessary']]} in {m['runs']} runs -> {out}")
    return 0


def cmd_carla(a) -> int:
    """Scripted CARLA executions of the 0G-reported boundary at one delay (parameters from 0G's final report)."""
    os.environ["DISPLAY"] = a.display
    from faultline.carla_world import CarlaWorld
    from faultline.experiment import idm_for
    from faultline.viewer import ChaseView
    run_dir = Path(a.run_dir)
    h = json.loads((run_dir / "hunt.json").read_text())
    d = next(r for r in h["results"] if r["method"] == "D-0G")
    b = _interp(d["estimate"], [a.delay])
    if b is None:
        sys.exit("the 0G run has no boundary estimate")
    summary = {"label": "scripted experiment execution; parameters from the 0G final report", "delay_s": a.delay,
               "boundary_0g_m": round(float(b[0]), 3)}
    for tag, gap in (("carla-safe", b[0] + 2.0), ("carla-unsafe", b[0] - 2.0)):
        out = run_dir / tag
        out.mkdir(exist_ok=True)
        p = _point(G1, round(float(gap), 3), a.delay)
        w = CarlaWorld(idm=idm_for(p), view=ChaseView(out), recorder_path=None)
        o = run_experiment(p, world=w, seed=a.seed)
        kin = run_experiment(p)
        summary[tag] = {"params": p, "carla": o, "kinematic": kin}
        (out / "experiment.json").write_text(json.dumps(summary[tag], indent=1) + "\n")
        print(tag, canonical(p), "carla safe", o["safe"], "min gap", o["min_gap_m"], "lidar min", o.get("lidar_min_gap_m"),
              "| kinematic safe", kin["safe"])
    (run_dir / "carla.json").write_text(json.dumps(summary, indent=1) + "\n")
    _live(f"carla pair at delay {a.delay}: safe-side safe={summary['carla-safe']['carla']['safe']} unsafe-side safe={summary['carla-unsafe']['carla']['safe']}")
    return 0


def main(argv=None) -> int:
    sys.stdout.reconfigure(line_buffering=True)
    p = argparse.ArgumentParser(prog="faultline.hunt")
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("ground-truth")
    g.add_argument("--refresh", action="store_true")
    g.set_defaults(fn=cmd_ground_truth)
    for name, fn in (("run", cmd_run), ("bench", cmd_bench)):
        s = sub.add_parser(name)
        if name == "run":
            s.add_argument("--goal", choices=list(GOALS), default="g1")
            s.add_argument("--budget", type=int)
        s.add_argument("--thinking", action="store_true", help="enable_thinking with a larger max_tokens")
        s.add_argument("--seed", type=int, default=0, help="seed of the random-sampling baseline")
        s.add_argument("--out")
        s.set_defaults(fn=fn)
    m = sub.add_parser("minimize")
    m.add_argument("--from", dest="src", help="hunt.json of a run")
    m.add_argument("--method", default="D-0G")
    m.add_argument("--index", type=int, help="experiment number (default: the first unsafe one)")
    m.add_argument("--params", help="JSON of an unsafe experiment instead of --from")
    m.add_argument("--out")
    m.set_defaults(fn=cmd_minimize)
    c = sub.add_parser("carla")
    c.add_argument("run_dir")
    c.add_argument("--delay", type=float, default=0.9)
    c.add_argument("--seed", type=int, default=7)
    c.add_argument("--display", default=":2")
    c.set_defaults(fn=cmd_carla)
    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
