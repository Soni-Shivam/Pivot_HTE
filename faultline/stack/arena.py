"""A/B arena: the same cut-in scenario on the same site against several stacks.

python -m faultline.stack.arena --site r7l-2s3 --stacks pdm_lite,idm_lidar --mode script --script runs/cutin-002/decisions.jsonl
python -m faultline.stack.arena --site r7l-2s3 --stacks pdm_lite,idm_lidar --mode live      (fresh paid 0G decisions)

Modes (written into every output):
  script  IDENTICAL ADVERSARY SCRIPT: the accepted actions of a recorded run, in order, replayed open-loop against
          every stack (no 0G call). An action the adversary cannot take in that state becomes KEEP_LANE; after the
          script ends the adversary keeps its lane. Like-for-like.
  live    LIVE ADVERSARY: fresh 0G decisions for each stack, closed loop: the adversary sees each stack's behaviour
          and may play differently against each. That is the point; the two runs are not the same encounter.
One --stacks entry = one stack; several --site values = the bridge demo across sites.
"""
import argparse
import json
import os
import subprocess
import time
from dataclasses import asdict
from pathlib import Path

from faultline import ledger
from faultline.cutin import CutInScenario
from faultline.episode import run_episode
from faultline.router import Decision
from faultline.stack import sites as sitecat
from faultline.stack.check import ROOT, resolve
from faultline.stack.mission import mission_metrics


class ScriptDecider:
    source, model = "replayed", "script"

    def __init__(self, path: Path):
        es = [json.loads(l) for l in Path(path).read_text().splitlines()]
        self.actions = [e["action"] for e in es if e["source"] != "none" and e["action"]]
        self.path, self.n = str(path), 0
        self.model = f"script:{self.path}"

    def decide(self, obs, history, available) -> Decision:
        a = self.actions[self.n] if self.n < len(self.actions) else "KEEP_LANE"
        self.n += 1
        return Decision(action=a if a in available else "KEEP_LANE", reason="ok", request_id=None, provider=None,
                        zg_res_key=None, model=self.model, latency_ms=0, http_status=None, raw_sha256=None,
                        content=None, ratelimit_remaining=None)


def live_decider():
    from faultline import cutin
    from faultline.cli import load_dotenv
    from faultline.router import ZgRouter
    load_dotenv()
    url, key = os.environ.get("ZG_ROUTER_URL"), os.environ.get("ZG_API_KEY")
    if not url or not key:
        raise SystemExit("ZG_ROUTER_URL and ZG_API_KEY must be set in .env")
    return ZgRouter(url, key, system_prompt=cutin.SYSTEM_PROMPT)


def run_one(stack_spec: str, site: dict, decider, out: Path, seed: int, record: bool = True) -> dict:
    from faultline.stack.check import digest
    from faultline.stack.world import SimClockRecorder, StackCutInScenario, StackCutInWorld
    spec, factory = resolve(stack_spec)
    stack = factory()
    s = StackCutInScenario(seed=seed, lane_width_m=site["lane_width_m"], site_id=site["id"],
                           stack_name=spec["name"], stack_digest=digest(spec["files"]))
    out.mkdir(parents=True, exist_ok=True)
    rec = SimClockRecorder(out, f"{spec['name']} @ {site['id']}") if record else None
    w = StackCutInWorld(stack, site, recorder=rec)
    m = run_episode(w, decider, s, out, extra={"site": site["id"], "stack": spec["name"], "stack_digest": s.stack_digest,
                                               "adversary_mode": getattr(decider, "mode_label", "")})
    rows = [json.loads(l) for l in (out / "trajectory.jsonl").read_text().splitlines()]
    mm = mission_metrics(rows, w.mission)
    lat = sorted(w.latencies)
    mm["stack"] = {"name": spec["name"], "digest": s.stack_digest, "steps": len(lat),
                   "p50_ms": round(lat[len(lat) // 2] * 1e3, 2) if lat else None,
                   "max_ms": round(lat[-1] * 1e3, 2) if lat else None, "invalid_controls": w.invalid_controls,
                   "timeouts": getattr(stack, "timeouts", 0)}
    (out / "mission.json").write_text(json.dumps(mm, indent=1, sort_keys=True) + "\n")
    met = json.loads((out / "metrics.json").read_text())
    gt, ext = met.get("ground_truth", {}), met.get("extended", {})
    return {"run": str(out.relative_to(ROOT)) if ROOT in out.resolve().parents else str(out), "site": site["id"],
            "stack": spec["name"], "digest": s.stack_digest, "status": m["status"],
            "decisions_0g": m["decisions_0g"], "route_completion_pct": mm["route_completion_pct"],
            "driving_score": mm["driving_score"], "mission_success": mm["mission_success"],
            "collision": gt.get("collision"), "ccs_gt": gt.get("ccs"), "min_ttc_s": gt.get("min_ttc_s"),
            "min_gap_m": gt.get("min_gap_in_path_m"), "max_decel_mps2": gt.get("max_ego_decel_mps2"),
            "brake_reaction_s": ext.get("brake_reaction_s"), "max_jerk_mps3": ext.get("ego_max_jerk_mps3"),
            "comfort_index": ext.get("comfort_index"),
            "infractions": mm["infractions"], "p50_ms": mm["stack"]["p50_ms"]}


def side_by_side(a: Path, b: Path, out: Path) -> None:
    """Two sim-clocked runs (one frame per tick each) in one 1920x1080 frame; the shorter one holds its last frame."""
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(a / "screen.mp4"), "-i", str(b / "screen.mp4"),
                    "-filter_complex", "[0:v]tpad=stop_mode=clone:stop_duration=30[l];[1:v]tpad=stop_mode=clone:"
                    "stop_duration=30[r];[l][r]hstack=shortest=0,pad=1920:1080:0:270:black[v]", "-map", "[v]",
                    "-t", str(max(_dur(a / "screen.mp4"), _dur(b / "screen.mp4"))), "-c:v", "libx264",
                    "-preset", "veryfast", "-pix_fmt", "yuv420p", str(out)], check=False)


def _dur(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


COLS = ("site", "stack", "status", "decisions_0g", "route_completion_pct", "driving_score", "mission_success",
        "collision", "ccs_gt", "min_ttc_s", "min_gap_m", "max_decel_mps2", "brake_reaction_s", "max_jerk_mps3",
        "comfort_index", "p50_ms")


def table(results: list[dict]) -> str:
    f = lambda v: f"{v:.3g}" if isinstance(v, float) else str(v)
    return "\n".join(["| " + " | ".join(COLS) + " |", "|" + "---|" * len(COLS)] +
                     ["| " + " | ".join(f(r.get(c)) for c in COLS) + " |" for r in results])


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m faultline.stack.arena")
    p.add_argument("--site", required=True, help="site id(s) from sites_town10.json, comma-separated, or 'seed:N'")
    p.add_argument("--stacks", default="pdm_lite", help="comma list of stacks/<name>.yaml names or spec paths")
    p.add_argument("--mode", choices=("script", "live"), default="script")
    p.add_argument("--script", default="runs/cutin-002/decisions.jsonl")
    p.add_argument("--scenario", default="cut_in_v1", help="scenario family/version (only cut_in_v1 is bridged)")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--out")
    a = p.parse_args(argv)
    assert a.scenario == "cut_in_v1", "only the cut-in family runs through the stack bridge so far"
    sites = [sitecat.select(int(x[5:])) if x.startswith("seed:") else sitecat.by_id(x) for x in a.site.split(",")]
    specs = [x if x.endswith((".yaml", ".json")) or ":" in x else f"stacks/{x}.yaml" for x in a.stacks.split(",")]
    out = Path(a.out or ROOT / "runs" / f"arena-{time.strftime('%Y%m%dT%H%M%S')}").resolve()
    out.mkdir(parents=True, exist_ok=True)
    label = ("IDENTICAL ADVERSARY SCRIPT (open loop, replayed from " + a.script + ", no 0G calls)" if a.mode == "script"
             else "LIVE ADVERSARY (fresh 0G decisions per stack, closed loop: the adversary may play differently "
                  "against each stack)")
    log = lambda msg: open(ROOT / "runs" / "agent-live.log", "a").write(time.strftime("%H:%M:%S") + f" [stack-agent] {msg}\n")
    results = []
    for site in sites:
        dirs = []
        for sp in specs:
            dec = ScriptDecider(ROOT / a.script) if a.mode == "script" else live_decider()
            dec.mode_label = a.mode
            d = out / f"{site['id']}__{Path(sp).stem}"
            r = run_one(sp, site, dec, d, a.seed)
            r["adversary_mode"] = a.mode
            results.append(r)
            dirs.append(d)
            log(f"arena {out.name} {a.mode}: {r['stack']} @ {site['id']} -> completion {r['route_completion_pct']:.0f}% "
                f"DS {r['driving_score']:.1f} collision {r['collision']} min TTC {r['min_ttc_s']} 0G {r['decisions_0g']}")
        if len(dirs) == 2:
            side_by_side(dirs[0], dirs[1], out / f"{site['id']}__side_by_side.mp4")
    (out / "compare.json").write_text(json.dumps({"mode": a.mode, "label": label, "scenario": a.scenario,
                                                  "seed": a.seed, "results": results}, indent=1) + "\n")
    (out / "compare.md").write_text(f"# Arena {out.name}\n\nAdversary: **{label}**\n\nScenario {a.scenario}, seed {a.seed}; "
                                    "driving score = route completion x infraction penalty (faultline/stack/mission.py)."
                                    f"\n\n{table(results)}\n")
    print((out / "compare.md").read_text())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
