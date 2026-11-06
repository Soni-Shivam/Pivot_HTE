"""Swarm episode with the deterministic tactics layer (faultline/tactics.py) between the world and the LLM, without
editing swarm.py: the world's tick is recorded for online ego identification, swarm.forecast is replaced by the
identified-ego, escapability-filtered, scored menu, and the router sees only fair options. The per-car allowed-action
schema and the strict parse are swarm's own (any action outside the offered set -> every car halts,
`source: "none"`). Audit per checkpoint -> tactics.jsonl, episode summary -> tactics_summary.json.

mode "tactics": filter + identified-ego menu. mode "audit": the original nominal forecast and full menu go to the
model (the baseline), the tactics evaluation is computed and logged only, so both arms get the same validity audit.
"""
import json
from pathlib import Path

from faultline import swarm, tactics

NOTE = ("forecast rows: our local model of THIS ego (observation.ego_model, identified online from its observed "
        "reaction delay, braking and headway), over 2.0 s; joint actions the ego could not escape even at its best "
        "response (brake hard after its reaction delay, or a free left lane) were removed from every car's "
        "available_actions; ranked by criticality, novel = not used earlier this episode")


def run(world, router, s, out_dir, mode: str = "tactics", plan_entry=None) -> dict:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    rec, pending, audits, used = [], {}, [], set()
    orig_tick, orig_forecast, orig_decide = world.tick, swarm.forecast, router.decide_joint

    def tick():
        st = orig_tick()
        rec.append(st)
        return st

    def forecast(w, last, s_, available, *a, **kw):
        model = tactics.identify(rec, s_.dt_s)
        cands, allowed = tactics.evaluate(w, last, s_, available, model, used)
        pending.update(model=model, cands=cands, allowed=allowed, full=available)
        if mode == "tactics":
            return tactics.menu_rows(cands, swarm.FORECAST_ROWS)
        return orig_forecast(w, last, s_, available, *a, **kw)

    def decide_joint(obs, history, available):
        cands, allowed = pending.get("cands") or [], pending.get("allowed") or available
        if mode == "tactics" and cands:
            obs["ego_model"], obs["forecast_note"] = pending["model"], NOTE
            obs["n_unfair_joint_actions_removed"] = sum(not x["fair"] for x in cands)
            for c, v in obs["cars"].items():
                v["available_actions"] = list(allowed[c])
                v["state"] = swarm.car_state(world.advs[c], v["gap_m"], v["available_actions"], s.lane_width_m)
            obs["reply_schema"]["actions"] = {c: "<one of: " + "|".join(v["available_actions"]) + ">"
                                              for c, v in obs["cars"].items()}
            available = swarm.available_map(obs)
        d, acts = orig_decide(obs, history, available)
        ok = acts is not None and d.reason == "ok"
        a = tactics.audit(obs["checkpoint"], obs["sim_time_s"], acts if ok else None, cands)
        a.update(mode=mode, ego_model=pending.get("model"), request_id=d.request_id,
                 removed={c: sorted(set(v) - set(allowed[c])) for c, v in (pending.get("full") or {}).items()})
        audits.append(a)
        if ok:
            used.add(tactics._label({c: acts[c] for c in (cands[0]["actions"] if cands else acts)}))
        pending.clear()
        return d, acts

    world.tick, swarm.forecast, router.decide_joint = tick, forecast, decide_joint
    try:
        manifest = swarm.run_swarm_episode(world, router, s, out_dir, lookahead=True, plan_entry=plan_entry)
    finally:
        swarm.forecast = orig_forecast
    with (out_dir / "tactics.jsonl").open("w") as f:
        for a in audits:
            f.write(json.dumps(a, sort_keys=True) + "\n")
    traj = [json.loads(x) for x in (out_dir / "trajectory.jsonl").read_text().splitlines()]
    summ = {"mode": mode, **tactics.summarize(audits, traj, s.checkpoint_s)}
    (out_dir / "tactics_summary.json").write_text(json.dumps(summ, indent=2, sort_keys=True) + "\n")
    return {**manifest, "tactics": summ}


def main(argv=None) -> int:
    import argparse
    import os

    from faultline.cli import load_dotenv
    p = argparse.ArgumentParser(prog="faultline.smart_swarm")
    p.add_argument("--out", required=True)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--mode", choices=("tactics", "audit"), default="tactics")
    a = p.parse_args(argv)
    load_dotenv()
    out = Path(a.out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"refusing to overwrite {out}")
    url, key = os.environ["ZG_ROUTER_URL"], os.environ["ZG_API_KEY"]
    m = run(swarm.KinematicSwarmWorld(), swarm.JointRouter(url, key), swarm.sample_scenario(a.seed), out, a.mode)
    print(json.dumps({k: m.get(k) for k in ("status", "collision", "decisions_0g", "decisions_halt", "tactics")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
