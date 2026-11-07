"""MAP-Elites style swarm campaign (kinematic two-lane world, real 0G calls, private tier).

Each episode: a seeded varied start (swarm.sample_scenario), one thinking-mode plan, one non-thinking joint decision
per checkpoint, ground-truth scoring. The behaviour cell is measured from what actually happened
(swarm.behaviour_cell: dominant pressure x first-threat timing, 4 x 4). The archive keeps the best valid episode
per cell by ground-truth CCS (valid = plan parsed, no SAFE_HALT, no adversary contact). With --archive the planner
sees the grid (filled cells with plan names and scores, empty cells) and is asked to target an empty cell; the
baseline arm gets the same starts and the plain planner prompt. J = ALPHA*CCS + BETA*novelty - DELTA*invalid is
logged per episode (deterministic code; the model never scores itself).

    .venv/bin/python -m faultline.campaign --out runs/campaign-001/archive --episodes 12 --archive
    .venv/bin/python -m faultline.campaign --out runs/campaign-001/baseline --episodes 12
    .venv/bin/python -m faultline.campaign --html runs/campaign-001     # campaign.html from both arms
"""
import html
import json
import time
from pathlib import Path

from faultline import swarm

ALPHA, BETA, DELTA = 1.0, 0.5, 0.5
CELLS = [(p, t) for p in swarm.PRESSURE for t in swarm.TIMING]
ROOT = Path(__file__).resolve().parent.parent


def archive_view(archive: dict, rotate: int = 0) -> dict:
    """rotate: start the empty-cell list at a different cell each episode (campaign-001: the planner kept picking the
    first listed empty cell)."""
    empty = [{"pressure": p, "first_threat": t} for p, t in CELLS if f"{p}|{t}" not in archive]
    k = rotate % len(empty) if empty else 0
    return {"axes": swarm.ARCHIVE_AXES,
            "cells": [{"pressure": k.split("|")[0], "first_threat": k.split("|")[1], "plan": v["plan"],
                       "gt_ccs": round(v["ccs"], 2)} for k, v in sorted(archive.items())],
            "empty_cells": empty[k:] + empty[:k]}


def score(ccs: float, new_cell: bool, valid: bool) -> float:
    return round(ALPHA * ccs + BETA * (1.0 if new_cell and valid else 0.0) - DELTA * (0.0 if valid else 1.0), 4)


def update(archive: dict, ep: dict) -> bool:
    """Insert the episode if valid and better than the cell's elite. Returns whether the cell was new."""
    k, new = ep["cell_key"], ep["cell_key"] not in archive
    if ep["valid"] and (new or ep["ccs"] > archive[k]["ccs"]):
        archive[k] = {"run": ep["run"], "plan": ep["plan_name"], "ccs": ep["ccs"], "episode": ep["i"]}
    return new


def run_campaign(out: Path, episodes: int, use_archive: bool, seed0: int, planner, router_factory,
                 lookahead: bool = False, log=print) -> dict:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    archive, eps = {}, []
    for i in range(episodes):
        s = swarm.sample_scenario(seed0 + i)
        d = out / f"ep-{i:02d}"
        pe = swarm.run_planner(planner, s, d, archive=archive_view(archive, i) if use_archive else None)
        m = swarm.run_swarm_episode(swarm.KinematicSwarmWorld(), router_factory(), s, d, lookahead=lookahead,
                                    plan_entry=pe)
        from faultline.director import decisions_html
        decisions_html(d)
        met = json.loads((d / "metrics.json").read_text())
        x, gt = met["extended"], met["ground_truth"]
        valid = pe["plan"] is not None and not m["adv_contact"] and m["decisions_halt"] == 0
        ep = {"i": i, "run": str(d.relative_to(out.parent)) if out.parent in d.parents else str(d),
              "seed": s.seed, "layout": s.layout, "plan_name": (pe["plan"] or {}).get("name"),
              "plan_summary": (pe["plan"] or {}).get("summary"), "target_cell": (pe["plan"] or {}).get("target_cell"),
              "plan_request_id": pe.get("request_id"), "cell": met["behaviour_cell"],
              "cell_key": "|".join(met["behaviour_cell"]), "ccs": gt["ccs"], "min_ttc_s": gt["min_ttc_s"],
              "collision": m["collision"], "adv_contact": m["adv_contact"], "decisions_0g": m["decisions_0g"],
              "decisions_halt": m["decisions_halt"], "valid": valid, "cost_usd": x["cost_usd"],
              "prompt_tokens": x["prompt_tokens"], "completion_tokens": x["completion_tokens"]}
        ep["new_cell"] = update(archive, ep)
        ep["J"] = score(gt["ccs"], ep["new_cell"], valid)
        ep["coverage_after"] = len(archive)
        eps.append(ep)
        data = {"schema": "faultline.campaign/v1", "arm": "archive" if use_archive else "baseline",
                "episodes_planned": episodes, "seed0": seed0, "lookahead": lookahead,
                "plan_max_tokens": getattr(planner, "max_tokens", None),
                "weights": {"alpha": ALPHA, "beta": BETA, "delta": DELTA}, "cells": [f"{p}|{t}" for p, t in CELLS],
                "episodes": eps, "archive": archive, "coverage": len(archive),
                "cells_visited": len({e["cell_key"] for e in eps}),
                "distinct_plan_names": len({(e["plan_name"] or "").lower() for e in eps if e["plan_name"]}),
                "cost_usd": round(sum(e["cost_usd"] or 0 for e in eps), 6)}
        (out / "campaign.json").write_text(json.dumps(data, indent=1) + "\n")
        log(f"{out.name} ep {i}: {s.layout} plan {ep['plan_name']!r} target {ep['target_cell']} -> cell {ep['cell']} "
            f"CCS {gt['ccs']:.2f} valid {valid} J {ep['J']} coverage {len(archive)} cost {ep['cost_usd']}")
    return data


def _link(root: Path, run: str, name: str) -> str | None:
    return f"{run}/{name}" if (root / run / name).exists() else None


def campaign_html(root: Path) -> Path:
    """Self-contained page: both arms' archive grids filling up episode by episode (slider), each cell with plan name,
    CCS and links to the episode's files; per-episode table."""
    root = Path(root)
    arms = {}
    for arm in ("archive", "baseline"):
        p = root / arm / "campaign.json"
        if p.exists():
            d = json.loads(p.read_text())
            for e in d["episodes"]:
                e["links"] = {k: _link(root, e["run"], f) for k, f in (("decisions", "decisions.html"),
                              ("plan", "plan.json"), ("metrics", "metrics.json"))}
            arms[arm] = d
    for extra in sorted(root.glob("carla-*/manifest.json")):  # CARLA re-runs of elites
        m = json.loads(extra.read_text())
        arms.setdefault("carla", []).append({"run": extra.parent.name, "plan": m.get("plan_name"),
                                             "video": _link(root, extra.parent.name, "stitched.mp4") or
                                             _link(root, extra.parent.name, "director.mp4"),
                                             "decisions": _link(root, extra.parent.name, "decisions.html"),
                                             "source": m.get("elite_of")})
    data = json.dumps({"arms": arms, "pressure": list(swarm.PRESSURE), "timing": list(swarm.TIMING),
                       "axes": swarm.ARCHIVE_AXES}).replace("</", "<\\/")
    page = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Swarm campaign</title><style>
:root{{--bg:#0f1117;--fg:#e6e6e6;--mut:#9aa;--card:#1a1d27;--line:#2c3040;--acc:#8f7bff;--ok:#5fd38d}}
@media (prefers-color-scheme: light){{:root:not([data-theme=dark]){{--bg:#fafafa;--fg:#1a1a1a;--mut:#666;--card:#fff;--line:#ddd;--acc:#5a46d6;--ok:#1d8a4a}}}}
body{{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:1200px;padding:0 16px;background:var(--bg);color:var(--fg)}}
.arms{{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px}}
table.g{{border-collapse:collapse;width:100%;table-layout:fixed}}.g td,.g th{{border:1px solid var(--line);padding:4px;vertical-align:top;font-size:12px}}
.g td{{height:70px;background:var(--card)}}.g td.f{{background:color-mix(in srgb,var(--acc) 22%,var(--card))}}
.g td.n{{outline:2px solid var(--ok);outline-offset:-2px}}.mut{{color:var(--mut)}}a{{color:var(--acc)}}
table.e{{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px}}.e td,.e th{{border-bottom:1px solid var(--line);padding:3px 6px;text-align:left}}
.wrap{{overflow-x:auto}}input[type=range]{{width:100%}}</style></head><body>
<h1>Swarm quality-diversity campaign</h1>
<p class="mut">Kinematic two-lane world, 0GM via the 0G Router (private tier): one thinking-mode plan + one joint decision per
checkpoint. Cell = what actually happened (pressure × first threat); elite = best valid episode by ground-truth CCS.
<b>archive</b> arm: the planner sees this grid and targets an empty cell. <b>baseline</b>: same starts, no archive. Not anchored.</p>
<label>after episode <b id="kl"></b><input id="k" type="range" min="1" value="1"></label>
<div class="arms" id="arms"></div><div id="carla"></div>
<script>const D={data};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c]));
const arms=Object.entries(D.arms).filter(([k])=>k!=='carla');const N=Math.max(1,...arms.map(([,a])=>a.episodes.length));
const K=document.getElementById('k');K.max=N;K.value=N;
function render(){{const k=+K.value;document.getElementById('kl').textContent=k;let h='';
for(const [name,a] of arms){{const eps=a.episodes.slice(0,k),arc={{}};let newest=null;
for(const e of eps){{const c=arc[e.cell_key];if(e.valid&&(!c||e.ccs>c.ccs)){{arc[e.cell_key]=e;newest=e.cell_key}}}}
h+=`<section><h2>${{esc(name)}} arm · coverage ${{Object.keys(arc).length}}/16 after ${{eps.length}} episodes</h2><div class="wrap"><table class="g"><tr><th></th>${{D.timing.map(t=>`<th>${{t}}</th>`).join('')}}</tr>`;
for(const p of D.pressure){{h+=`<tr><th>${{p}}</th>`;for(const t of D.timing){{const e=arc[p+'|'+t];
h+=e?`<td class="f${{p+'|'+t===newest&&eps[eps.length-1].cell_key===newest?' n':''}}"><b>${{esc(e.plan_name)}}</b><br>CCS ${{e.ccs.toFixed(2)}} · ep ${{e.i}}<br>${{e.links.decisions?`<a href="${{e.links.decisions}}">decisions</a>`:`<a href="${{e.links.plan}}">plan</a>`}}</td>`:'<td></td>'}}h+='</tr>'}}
h+=`</table></div><table class="e"><tr><th>ep</th><th>layout</th><th>plan</th><th>target</th><th>cell</th><th>CCS</th><th>valid</th><th>J</th><th>cost</th></tr>`;
for(const e of eps)h+=`<tr><td>${{e.i}}</td><td>${{esc(e.layout)}}</td><td title="${{esc(e.plan_summary)}}">${{esc(e.plan_name)}}</td><td>${{e.target_cell?esc(e.target_cell.pressure+' × '+e.target_cell.first_threat):''}}</td><td>${{esc(e.cell.join(' × '))}}</td><td>${{e.ccs.toFixed(2)}}</td><td>${{e.valid?'yes':'no'}}</td><td>${{e.J}}</td><td>${{e.cost_usd!=null?'$'+e.cost_usd.toFixed(5):''}}</td></tr>`;
h+=`</table><p class="mut">cost ${{'$'+a.cost_usd.toFixed(4)}} · ${{a.distinct_plan_names}} distinct plan names · ${{a.cells_visited}} cells visited</p></section>`}}
document.getElementById('arms').innerHTML=h;
const c=D.arms.carla||[];document.getElementById('carla').innerHTML=c.length?'<h2>Elites re-run in CARLA (PDM-Lite on LiDAR)</h2><ul>'+c.map(r=>`<li><b>${{esc(r.plan)}}</b> (${{esc(r.run)}}, elite of ${{esc(r.source)}}): ${{r.video?`<a href="${{r.video}}">video</a>`:''}} ${{r.decisions?`<a href="${{r.decisions}}">decisions</a>`:''}}</li>`).join('')+'</ul>':''}}
K.oninput=render;render();</script></body></html>"""
    p = root / "campaign.html"
    p.write_text(page)
    return p


def log_live(msg: str) -> None:
    with open(ROOT / "runs" / "agent-live.log", "a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} [explore-agent] {msg}\n")


def main(argv=None) -> int:
    import argparse
    import os

    from faultline.cli import load_dotenv
    p = argparse.ArgumentParser(prog="faultline.campaign")
    p.add_argument("--out")
    p.add_argument("--episodes", type=int, default=12)
    p.add_argument("--seed0", type=int, default=100)
    p.add_argument("--archive", action="store_true", help="show the planner the archive grid (else: baseline)")
    p.add_argument("--lookahead", action="store_true")
    p.add_argument("--plan-max-tokens", type=int, default=12000,
                   help="planner thinking+answer cap (campaign-001 used 6000: 6/12 archive plans truncated)")
    p.add_argument("--html", help="write campaign.html for a campaign root (arms in archive/ and baseline/)")
    a = p.parse_args(argv)
    if a.html:
        print(campaign_html(Path(a.html)))
        return 0
    load_dotenv()
    out = Path(a.out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"refusing to overwrite {out}")
    url, key = os.environ["ZG_ROUTER_URL"], os.environ["ZG_API_KEY"]
    planner = swarm.PlannerRouter(url, key, prompt=swarm.CAMPAIGN_PLANNER_PROMPT if a.archive else swarm.PLANNER_PROMPT,
                                 max_tokens=a.plan_max_tokens)
    d = run_campaign(out, a.episodes, a.archive, a.seed0, planner, lambda: swarm.JointRouter(url, key),
                     a.lookahead, log=lambda m: (print(m), log_live(m)))
    log_live(f"{out} done: coverage {d['coverage']}/16, cells visited {d['cells_visited']}, "
             f"{d['distinct_plan_names']} distinct plans, cost ${d['cost_usd']:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
