"""
kinematics.py
=============
Pure-numpy kinematic criticality quantities (TTC, DRAC, THW, ...).

Vendored from SeDriCa/MBRDI-Development (MIT); the e2e_core transform helpers were removed.
"""

from __future__ import annotations

import numpy as np


def relative_velocity_1d(v_follower: np.ndarray, v_lead: np.ndarray) -> np.ndarray:
    """Signed relative velocity: positive when follower is faster than lead."""
    return v_follower - v_lead


# ---------------------------------------------------------------------------
# TTC (Time-to-Collision)  — 1-D constant-velocity model
# ---------------------------------------------------------------------------

def ttc_1d(
    gap: np.ndarray,
    v_rel: np.ndarray,
    clip_max: float = 60.0,
) -> np.ndarray:
    """Compute TTC for a longitudinal car-following pair.

    Parameters
    ----------
    gap   : bumper-to-bumper distance (m), shape (...)
    v_rel : follower_speed − lead_speed  (m/s), shape (...)
    clip_max : value returned when TTC would be infinite (s)

    Returns
    -------
    TTC in seconds, clipped to [0, clip_max].
    """
    safe = np.where(v_rel > 1e-3, v_rel, np.nan)
    raw = gap / safe
    raw = np.where(np.isfinite(raw) & (raw >= 0), raw, clip_max)
    return np.clip(raw, 0.0, clip_max)


def drac(
    gap: np.ndarray,
    v_rel: np.ndarray,
    clip_max: float = 20.0,
) -> np.ndarray:
    """Required deceleration (m/s²) for follower to avoid collision.

    DRAC = v_rel² / (2 * gap)

    Positive value = required *braking*. Returns 0 when gap ≤ 0 or v_rel ≤ 0
    (no conflict). Clipped to clip_max.
    """
    conflict = (v_rel > 1e-3) & (gap > 1e-3)
    raw = np.where(conflict, (v_rel ** 2) / (2.0 * np.where(gap > 1e-3, gap, 1.0)), 0.0)
    return np.clip(raw, 0.0, clip_max)


# ---------------------------------------------------------------------------
# BTN / STN  (Brake/Steer Threat Number)
# ---------------------------------------------------------------------------

def btn(drac_val: np.ndarray, a_max_brake: float = 8.0) -> np.ndarray:
    """Brake Threat Number = DRAC / a_max_brake.

    BTN ≥ 1 → braking alone cannot avoid the collision.
    Typical a_max_brake = 8 m/s² (passenger car emergency braking).
    """
    return drac_val / a_max_brake


# ---------------------------------------------------------------------------
# THW (Time Headway)
# ---------------------------------------------------------------------------

def thw(gap: np.ndarray, v_ego: np.ndarray, clip_max: float = 10.0) -> np.ndarray:
    """Time Headway = gap / v_ego  (seconds).

    Returns clip_max when ego is stationary.
    """
    safe_v = np.where(v_ego > 0.5, v_ego, np.nan)
    raw = gap / safe_v
    return np.where(np.isfinite(raw) & (raw >= 0), np.clip(raw, 0, clip_max), clip_max)


# ---------------------------------------------------------------------------
# PET (Post-Encroachment Time) — spatial conflict-area based
# ---------------------------------------------------------------------------

def pet_from_entry_exit_times(
    t_first_exit: float,
    t_second_entry: float,
) -> float:
    """PET = time second road user enters conflict area after first one left.

    Both arguments are simulation timestamps (seconds).
    Returns float (s) or np.inf when no encroachment.
    """
    if t_second_entry > t_first_exit:
        return t_second_entry - t_first_exit
    return np.inf


# ---------------------------------------------------------------------------
# TET / TIT (Time-Exposed TTC / Time-Integrated TTC)
# ---------------------------------------------------------------------------

def tet(ttc_series: np.ndarray, threshold: float = 1.5, dt: float = 0.05) -> float:
    """Time (s) during which TTC was below *threshold*.

    Parameters
    ----------
    ttc_series : 1-D array of per-step TTC values
    threshold  : critical TTC threshold (s), default 1.5 s
    dt         : simulation timestep (s), default 0.05 s (20 Hz)
    """
    return float(np.sum(ttc_series < threshold) * dt)


def tit(ttc_series: np.ndarray, threshold: float = 1.5, dt: float = 0.05) -> float:
    """Time-Integrated TTC: integral of (threshold - TTC) over TTC < threshold.

    More sensitive than TET as it weights how far below threshold TTC drops.
    """
    below = ttc_series < threshold
    return float(np.sum((threshold - ttc_series[below])) * dt)


# ---------------------------------------------------------------------------
# RSS safe distance (longitudinal, simplified)
# ---------------------------------------------------------------------------

def rss_safe_distance(
    v_rear: np.ndarray,
    v_front: np.ndarray,
    rho: float = 0.5,
    a_max_accel: float = 3.5,
    a_min_brake: float = 4.0,
    a_max_brake: float = 8.0,
) -> np.ndarray:
    """Longitudinal RSS minimum safe distance (Shalev-Shwartz 2017).

    d_min = v_rear*rho + 0.5*a_max_accel*rho^2
            + (v_rear + rho*a_max_accel)^2 / (2*a_min_brake)
            - v_front^2 / (2*a_max_brake)

    Returns 0-clipped result (negative means already safe).
    """
    term1 = v_rear * rho + 0.5 * a_max_accel * rho ** 2
    v_rear_after = v_rear + rho * a_max_accel
    term2 = (v_rear_after ** 2) / (2.0 * a_min_brake)
    term3 = (v_front ** 2) / (2.0 * a_max_brake)
    d_min = term1 + term2 - term3
    return np.maximum(d_min, 0.0)


def rss_danger_score(
    actual_gap: np.ndarray,
    v_rear: np.ndarray,
    v_front: np.ndarray,
    **rss_kwargs,
) -> np.ndarray:
    """RSS Danger Score = max(0, d_min - actual_gap).

    0   → safe
    > 0 → dangerous, magnitude = how much extra gap is needed.
    """
    d_min = rss_safe_distance(v_rear, v_front, **rss_kwargs)
    return np.maximum(d_min - actual_gap, 0.0)


# ---------------------------------------------------------------------------
# 2-D geometric criticality — the "accurate" model
# ---------------------------------------------------------------------------
#
# Why this section exists
# ------------------------
# Every metric above (TTC, DRAC, BTN, THW, longitudinal RSS) reduces the world
# to ONE dimension: the agent is projected onto the ego's heading and treated
# as a car-following pair. That model is *blind to crossing / turning traffic*.
#
# Consider an intersection where the ego goes straight and a second vehicle
# turns across its path. Their constant-velocity rays diverge, so a
# trajectory-intersection model reports "no collision" and the 1-D TTC returns
# its clip value (≈ ∞) — even when the two bumpers are only ~2 m apart at speed.
# That is a genuine near-miss the scalar TTC cannot see.
#
# The functions below operate on full 2-D position/velocity vectors and on the
# oriented vehicle footprints, so they remain sensitive to lateral geometry.


def world_velocity(yaw: np.ndarray, v_lon: np.ndarray, v_lat: np.ndarray | float = 0.0) -> np.ndarray:
    """Rotate a body-frame (longitudinal, lateral) velocity into the world frame.

    Parameters
    ----------
    yaw   : heading (rad), shape (...)
    v_lon : forward speed (m/s), shape (...)
    v_lat : lateral speed (m/s), shape (...)  (left-positive)

    Returns
    -------
    velocity : (..., 2) world-frame (vx, vy)
    """
    yaw = np.asarray(yaw, dtype=float)
    v_lon = np.asarray(v_lon, dtype=float)
    v_lat = np.asarray(v_lat, dtype=float) * np.ones_like(yaw)
    cos_y, sin_y = np.cos(yaw), np.sin(yaw)
    # forward = (cos, sin); left = (-sin, cos)
    vx = v_lon * cos_y - v_lat * sin_y
    vy = v_lon * sin_y + v_lat * cos_y
    return np.stack([vx, vy], axis=-1)


def closest_point_of_approach(dp: np.ndarray, dv: np.ndarray) -> tuple[float, float]:
    """Constant-velocity closest point of approach (CPA) for two point masses.

    Parameters
    ----------
    dp : (2,) relative position  p_agent − p_ego  (m)
    dv : (2,) relative velocity  v_agent − v_ego  (m/s)

    Returns
    -------
    t_cpa : time of minimum separation (s). Negative ⇒ the closest approach is
            already in the past (the pair is currently *separating*).
    d_cpa : minimum centre-to-centre distance attained at t_cpa (m).
    """
    dp = np.asarray(dp, dtype=float)
    dv = np.asarray(dv, dtype=float)
    denom = float(dv @ dv)
    if denom < 1e-9:                       # no relative motion → constant distance
        return 0.0, float(np.linalg.norm(dp))
    t_cpa = -float(dp @ dv) / denom
    d_cpa = float(np.linalg.norm(dp + t_cpa * dv))
    return t_cpa, d_cpa


def ttc_2d_point(dp: np.ndarray, dv: np.ndarray, radius_sum: float, clip_max: float = 60.0) -> float:
    """2-D Time-to-Collision using a constant-velocity closest-approach model.

    Two vehicles are abstracted as discs whose radii sum to *radius_sum*. TTC is
    the first future time at which the centre distance shrinks to ``radius_sum``.

    Returns ``clip_max`` (our stand-in for ∞) when the pair is separating, when
    the closest approach never reaches ``radius_sum``, or when the conflict lies
    in the past. This is exactly the case that makes a turning/crossing
    near-miss read as "safe": the rays diverge, so no future contact exists.

    Parameters
    ----------
    dp         : (2,) relative position p_agent − p_ego (m)
    dv         : (2,) relative velocity v_agent − v_ego (m/s)
    radius_sum : sum of the two vehicles' bounding radii (m)
    clip_max   : value returned for "no collision" (s)
    """
    dp = np.asarray(dp, dtype=float)
    dv = np.asarray(dv, dtype=float)
    a = float(dv @ dv)
    if a < 1e-9:                                   # not closing at all
        return clip_max
    b = 2.0 * float(dp @ dv)
    c = float(dp @ dp) - radius_sum ** 2
    if c <= 0.0:                                   # already overlapping
        return 0.0
    disc = b * b - 4 * a * c
    if disc < 0.0:                                 # rays never come within radius_sum
        return clip_max
    sqrt_disc = np.sqrt(disc)
    t1 = (-b - sqrt_disc) / (2 * a)
    t2 = (-b + sqrt_disc) / (2 * a)
    # earliest non-negative root
    t_hit = min([t for t in (t1, t2) if t >= 0.0], default=clip_max)
    return float(np.clip(t_hit, 0.0, clip_max))


def vehicle_corners(x: float, y: float, yaw: float, length: float, width: float) -> np.ndarray:
    """Return the 4 world-frame corners of an oriented vehicle footprint.

    Order: front-left, front-right, rear-right, rear-left. Shape (4, 2).
    """
    hl, hw = length / 2.0, width / 2.0
    # body-frame corners (forward = +x, left = +y)
    body = np.array([[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]])
    c, s = np.cos(yaw), np.sin(yaw)
    R = np.array([[c, -s], [s, c]])
    return (body @ R.T) + np.array([x, y])


def _point_segment_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    ab = b - a
    denom = float(ab @ ab)
    t = 0.0 if denom < 1e-12 else float(np.clip((p - a) @ ab / denom, 0.0, 1.0))
    return float(np.linalg.norm(p - (a + t * ab)))


def polygon_min_distance(poly_a: np.ndarray, poly_b: np.ndarray) -> float:
    """Minimum distance between two convex polygons (0.0 if they overlap).

    Exact for non-overlapping convex polygons: the minimum separation is always
    realised by a vertex of one polygon and an edge of the other. We test every
    vertex-vs-edge pair in both directions.
    """
    poly_a = np.asarray(poly_a, dtype=float)
    poly_b = np.asarray(poly_b, dtype=float)
    if _polygons_overlap(poly_a, poly_b):
        return 0.0
    best = np.inf
    for poly_p, poly_e in ((poly_a, poly_b), (poly_b, poly_a)):
        n = len(poly_e)
        for p in poly_p:
            for i in range(n):
                d = _point_segment_distance(p, poly_e[i], poly_e[(i + 1) % n])
                if d < best:
                    best = d
    return float(best)


def _polygons_overlap(poly_a: np.ndarray, poly_b: np.ndarray) -> bool:
    """Separating-axis test for two convex polygons."""
    for poly in (poly_a, poly_b):
        n = len(poly)
        for i in range(n):
            edge = poly[(i + 1) % n] - poly[i]
            axis = np.array([-edge[1], edge[0]])
            norm = np.linalg.norm(axis)
            if norm < 1e-12:
                continue
            axis = axis / norm
            pa = poly_a @ axis
            pb = poly_b @ axis
            if pa.max() < pb.min() - 1e-9 or pb.max() < pa.min() - 1e-9:
                return False
    return True
