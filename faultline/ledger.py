"""Performance ledger: one row per finished run (lead_brake, cut_in, swarm episodes; hunt / research summaries) in
runs/ledger.csv, and docs/evidence/faultline-ledger.md regenerated from it (per-family summary + every run).

Rows are computed only from what the run wrote (manifest, metrics, trajectory, decision / designer logs); a field
the run did not record stays blank. Backfilled rows (runs that finished before this ledger existed) say so.

    .venv/bin/python -m faultline.ledger --backfill     # every runs/* with a manifest
    .venv/bin/python -m faultline.ledger runs/<id>      # one run (the episode / swarm / campaign runners call this)
"""
import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from faultline.metrics.extended import call_stats, extended_metrics, usage_of_entry

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "runs" / "ledger.csv"
MD = ROOT / "docs" / "evidence" / "faultline-ledger.md"
COLUMNS = ["run", "family", "time", "backfilled", "world", "ego", "status", "plan_name", "behaviour_cell", "collision",
           "adv_contact", "ccs", "ccs_source", "min_ttc_s", "min_gap_m", "max_ego_decel_mps2", "tet_s", "tit_s2",
           "min_thw_s", "brake_reaction_s", "pet_s", "escape_space_m", "ego_efficiency", "comfort_index",
           "guard_ticks", "decisions_0g", "decisions_halt", "parse_rate", "latency_mean_ms", "latency_p95_ms", "calls",
           "calls_with_usage", "prompt_tokens", "completion_tokens", "cost_usd"]


def _jsonl(p: Path) -> list:
    return [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []


def _json(p: Path):
    return json.loads(p.read_text()) if p.exists() else None


def _mtime(p: Path) -> str:
    return datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def row_for(run: Path, backfilled: bool = False) -> dict | None:
    run = Path(run)
    m = _json(run / "manifest.json")
    if not isinstance(m, dict):
        return None
    r = {"run": run.name, "backfilled": int(backfilled), "time": m.get("started_at") or _mtime(run / "manifest.json")}
    if (run / "designer.jsonl").exists():  # hunt / research: a 0G experiment designer, no episode of its own
        r["family"] = "research" if "research" in (m.get("schema") or "") else "hunt"
        r["status"] = m.get("designer_status") or m.get("status")
        calls = [e for e in _jsonl(run / "designer.jsonl") if "latency_ms" in e]
        us = [usage_of_entry(e) for e in calls]
        with_u = [u for u, _ in us if u]
        replied = [e for e in calls if e.get("content")]
        r.update(calls=len(calls), calls_with_usage=len(with_u),
                 parse_rate=round(sum(e.get("parse") == "ok" for e in replied) / len(replied), 3) if replied else None,
                 prompt_tokens=sum(u.get("prompt_tokens") or 0 for u in with_u) if with_u else None,
                 completion_tokens=sum(u.get("completion_tokens") or 0 for u in with_u) if with_u else None,
                 cost_usd=round(sum(c for _, c in us if c), 8) if any(c for _, c in us) else None)
        lat = sorted(e["latency_ms"] for e in calls if e.get("latency_ms"))
        if lat:
            r["latency_mean_ms"] = round(sum(lat) / len(lat), 1)
        return r
    met = _json(run / "metrics.json")
    if not isinstance(met, dict):
        return None
    gt = met.get("ground_truth") if isinstance(met.get("ground_truth"), dict) else None
    r.update(family=m.get("family") or "lead_brake", world=m.get("world"), ego=m.get("ego"), status=m.get("status"),
             plan_name=m.get("plan_name"), collision=m.get("collision"), adv_contact=m.get("adv_contact"),
             decisions_0g=m.get("decisions_0g"), decisions_halt=m.get("decisions_halt"),
             behaviour_cell=" x ".join(met["behaviour_cell"]) if met.get("behaviour_cell") else None)
    if gt:
        r.update(ccs=gt.get("ccs"), ccs_source="ground_truth", min_ttc_s=gt.get("min_ttc_s"),
                 min_gap_m=gt.get("min_gap_in_path_m"), max_ego_decel_mps2=gt.get("max_ego_decel_mps2"))
    else:
        r.update(ccs=met.get("ccs"), ccs_source="lidar", min_ttc_s=met.get("min_ttc_s"), min_gap_m=met.get("min_gap_m"),
                 max_ego_decel_mps2=met.get("max_ego_decel_mps2"))
    x = met.get("extended")
    if x is None and (run / "trajectory.jsonl").exists() and (run / "scenario.json").exists():
        # backfill: the same deterministic function on the recorded trajectory and log; replays made no new calls
        dec = [] if (run / "replay.json").exists() else _jsonl(run / "decisions.jsonl")
        x = extended_metrics(_jsonl(run / "trajectory.jsonl"), dec, _json(run / "scenario.json"),
                             _json(run / "plan.json"))
    elif x is not None and (run / "replay.json").exists():
        x = {**x, **call_stats([])}
    for k in COLUMNS:
        if x and k in x and k not in r:
            r[k] = x[k]
    return r


def _fmt(v):
    if v is None or v == "":
        return ""
    if isinstance(v, float):
        return f"{v:.6g}"
    return str(v)


def load() -> dict:
    if not CSV.exists():
        return {}
    with CSV.open() as f:
        return {r["run"]: r for r in csv.DictReader(f)}


def save(rows: dict) -> None:
    CSV.parent.mkdir(parents=True, exist_ok=True)
    tmp = CSV.with_suffix(".tmp")
    with tmp.open("w", newline="") as f:
        w = csv.DictWriter(f, COLUMNS)
        w.writeheader()
        for r in sorted(rows.values(), key=lambda r: r.get("time") or ""):
            w.writerow({k: _fmt(r.get(k)) for k in COLUMNS})
    os.replace(tmp, CSV)
    write_md(load())


def record(run: Path, backfilled: bool = False) -> dict | None:
    """Add or replace the run's row, regenerate the markdown. Only for runs under runs/ (tests write elsewhere)."""
    run = Path(run).resolve()
    if run.parent != (ROOT / "runs").resolve():
        return None
    r = row_for(run, backfilled)
    if r is None:
        return None
    rows = load()
    if backfilled and run.name in rows and rows[run.name].get("backfilled") == "0":
        return rows[run.name]  # never downgrade a live row to backfilled
    rows[run.name] = r
    save(rows)
    return r


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def summary(rows: list) -> list:
    fams = {}
    for r in rows:
        fams.setdefault(r["family"], []).append(r)
    out = []
    for fam, rs in sorted(fams.items()):
        ccs = [x for x in (_num(r["ccs"]) for r in rs if r.get("ccs_source") == "ground_truth") if x is not None]
        ttc = [x for x in (_num(r["min_ttc_s"]) for r in rs) if x is not None]
        pr = [x for x in (_num(r["parse_rate"]) for r in rs) if x is not None]
        cost = [x for x in (_num(r["cost_usd"]) for r in rs) if x is not None]
        out.append({"family": fam, "runs": len(rs), "best_gt_ccs": max(ccs) if ccs else None,
                    "min_ttc_s": min(ttc) if ttc else None,
                    "collisions": sum(r["collision"] == "True" for r in rs),
                    "parse_rate": sum(pr) / len(pr) if pr else None,
                    "cost_per_run": sum(cost) / len(cost) if cost else None, "cost_total": sum(cost),
                    "costed_runs": len(cost)})
    return out


def write_md(rows: dict) -> None:
    rs = sorted(rows.values(), key=lambda r: r.get("time") or "", reverse=True)
    f = lambda v, fmt="{:.3g}": "" if _num(v) is None else fmt.format(_num(v))
    total = sum(_num(r["cost_usd"]) or 0 for r in rs)
    calls = sum(int(_num(r["calls"]) or 0) for r in rs)
    with_u = sum(int(_num(r["calls_with_usage"]) or 0) for r in rs)
    L = ["# Faultline performance ledger", "",
         "Generated by `faultline/ledger.py` from `runs/ledger.csv` (one row per finished run; the episode, swarm and "
         "campaign runners append automatically; `--backfill` adds older runs, marked `bf`). Blank = the run did not "
         "record it. Cost = the Router's billed micro-USD, else tokens × $0.08/M in, $0.48/M out (0GM model card); "
         "runs before 2026-11-07 logged usage only for designer calls and raw-body runs, so their cost is a lower "
         "bound.", "",
         f"**Cumulative recorded cost: ${total:.4f}** over {calls} 0G calls ({with_u} with usage recorded).", "",
         "## Per family", "", "| family | runs | best GT CCS | min TTC (s) | collisions | mean parse rate | "
         "cost / costed run | cost total | costed runs |", "|---|---|---|---|---|---|---|---|---|"]
    for s in summary(rs):
        L.append(f"| {s['family']} | {s['runs']} | {f(s['best_gt_ccs'], '{:.2f}')} | {f(s['min_ttc_s'], '{:.2f}')} | "
                 f"{s['collisions']} | {f(s['parse_rate'], '{:.0%}')} | {f(s['cost_per_run'], '${:.5f}')} | "
                 f"${s['cost_total']:.5f} | {s['costed_runs']} |")
    L += ["", "## Every run (newest first)", "",
          "| run | family | time (UTC) | status | plan | cell | coll. | CCS | min TTC | min gap | TET | min THW | "
          "react | PET | escape | eff. | guard | 0G/halt | parse | p95 ms | tokens in/out | cost |",
          "|" + "---|" * 22]
    for r in rs:
        L.append("| " + " | ".join([
            r["run"] + (" (bf)" if r.get("backfilled") == "1" else ""), r["family"], (r["time"] or "")[:16],
            r["status"] or "", r["plan_name"] or "", r["behaviour_cell"] or "", r["collision"] or "",
            f(r["ccs"], "{:.2f}") + ("" if r["ccs_source"] != "lidar" else " (L)"), f(r["min_ttc_s"], "{:.2f}"),
            f(r["min_gap_m"], "{:.2f}"), f(r["tet_s"], "{:.2f}"), f(r["min_thw_s"], "{:.2f}"),
            f(r["brake_reaction_s"], "{:.2f}"), f(r["pet_s"], "{:.2f}"), f(r["escape_space_m"], "{:.0f}"),
            f(r["ego_efficiency"], "{:.2f}"), r["guard_ticks"] or "",
            f"{r['decisions_0g'] or ''}/{r['decisions_halt'] or ''}" if r["decisions_0g"] or r["decisions_halt"] else "",
            f(r["parse_rate"], "{:.0%}"), f(r["latency_p95_ms"], "{:.0f}"),
            f"{r['prompt_tokens']}/{r['completion_tokens']}" if r["prompt_tokens"] else "",
            f(r["cost_usd"], "${:.5f}")]) + " |")
    L += ["", "CCS (L) = LiDAR-based episode CCS (lead_brake family, no ground-truth block). Column definitions: "
          "`faultline/metrics/extended.py`."]
    MD.write_text("\n".join(L) + "\n")


def backfill() -> int:
    n = 0
    for run in sorted((ROOT / "runs").iterdir()):
        if run.is_dir() and (run / "manifest.json").exists():
            n += record(run, backfilled=True) is not None
    return n


def main(argv=None) -> int:
    import argparse
    p = argparse.ArgumentParser(prog="faultline.ledger")
    p.add_argument("runs", nargs="*")
    p.add_argument("--backfill", action="store_true")
    a = p.parse_args(argv)
    if a.backfill:
        print(f"backfilled {backfill()} runs -> {CSV}")
    for r in a.runs:
        print(record(Path(r)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
