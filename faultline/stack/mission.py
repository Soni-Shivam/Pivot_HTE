"""The ego's task and how well it did it. A stack that "survives" by stopping scores low.

Driving score = route completion (%) x infraction penalty, the CARLA Leaderboard 2.0 composition
(leaderboard/utils/statistics_manager.py: score_composed = score_route * score_penalty; MIT, CARLA). Penalty
factors taken from it: vehicle collision x0.60, outside-route-lanes x(1 - % of route driven outside). Ours, not the
Leaderboard's: speeding (> 110 % of the limit for >= 1 s) x0.90 per event; "blocked" (stopped >= blocked_s before the
goal) freezes route completion at that moment (the Leaderboard ends the route there too, with no extra factor).
Computed from the episode's trajectory rows only (deterministic; the same rows give the same numbers).
"""
from dataclasses import dataclass

COLLISION_VEHICLE = 0.60  # Leaderboard 2.0 PENALTY_VALUE_DICT[COLLISION_VEHICLE]
SPEEDING_FACTOR, SPEEDING_MARGIN, SPEEDING_MIN_S = 0.90, 1.10, 1.0  # ours
STOPPED_MPS = 0.3


@dataclass(frozen=True)
class Mission:
    site_id: str
    start_xyz: tuple
    start_yaw_deg: float
    route_xyz: tuple  # ((x, y, z), ...) lane-centre samples, CARLA world frame; starts at the ego start
    goal_m: float = 70.0  # distance along the route to reach
    time_limit_s: float = 12.0
    speed_limit_mps: float = 30 / 3.6  # Town10 urban limit
    target_speed_mps: float = 8.0
    lane_width_m: float = 3.5
    lat_bounds_m: tuple = (-1.75, 5.25)  # lateral offsets from the start-lane centre that count as on-route lanes
    lane_rule: str = "same-direction lanes only (ego lane or the adjacent left lane)"
    blocked_s: float = 4.0
    route_gps: tuple = ()  # ((lat, lon, alt), ...) same samples, for GNSS-based stacks
    dt_s: float = 0.05  # the fixed simulation step Faultline ticks at


def mission_metrics(rows: list[dict], m: Mission) -> dict:
    """rows: trajectory dicts with t_s, ego_x (arc along the route), ego_v, ego_lat_m, collision."""
    if not rows:
        return {"route_completion_pct": 0.0, "driving_score": 0.0, "mission_success": False, "infractions": {}}
    x0, prev = rows[0]["ego_x"], rows[0]
    progress = goal_t = blocked_t = None
    best, out_m, stopped_from, over_from, speeding = 0.0, 0.0, None, None, []
    for r in rows:
        d = r["ego_x"] - x0
        if blocked_t is None:
            best = max(best, d)
        if not m.lat_bounds_m[0] <= r["ego_lat_m"] <= m.lat_bounds_m[1]:
            out_m += abs(r["ego_x"] - prev["ego_x"])
        if goal_t is None and d >= m.goal_m:
            goal_t = r["t_s"]
        if r["ego_v"] < STOPPED_MPS and goal_t is None:
            stopped_from = r["t_s"] if stopped_from is None else stopped_from
            if blocked_t is None and r["t_s"] - stopped_from >= m.blocked_s:
                blocked_t = r["t_s"]
        else:
            stopped_from = None
        if r["ego_v"] > SPEEDING_MARGIN * m.speed_limit_mps:
            over_from = r["t_s"] if over_from is None else over_from
        else:
            if over_from is not None and prev["t_s"] - over_from >= SPEEDING_MIN_S:
                speeding.append([over_from, prev["t_s"]])
            over_from = None
        prev = r
    if over_from is not None and prev["t_s"] - over_from >= SPEEDING_MIN_S:
        speeding.append([over_from, prev["t_s"]])
    collision = any(r["collision"] for r in rows)
    completion = min(100.0, 100.0 * best / m.goal_m)
    outside_pct = min(100.0, 100.0 * out_m / m.goal_m)
    penalty = (COLLISION_VEHICLE if collision else 1.0) * (1 - outside_pct / 100) * SPEEDING_FACTOR ** len(speeding)
    reached = goal_t is not None and goal_t <= m.time_limit_s
    r6 = lambda v: round(v, 6)
    return {"route_completion_pct": r6(completion), "infraction_penalty": r6(penalty),
            "driving_score": r6(completion * penalty), "mission_success": bool(reached and not collision),
            "goal_reached_t_s": goal_t, "goal_m": m.goal_m, "time_limit_s": m.time_limit_s,
            "episode_end_t_s": rows[-1]["t_s"],
            "infractions": {"collision": collision, "outside_route_lanes_pct": r6(outside_pct),
                            "speeding_events": speeding, "blocked_at_t_s": blocked_t,
                            "goal_not_reached_in_time": not reached}}
