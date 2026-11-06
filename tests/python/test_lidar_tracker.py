"""LiDAR clustering / box fitting / tracking on synthetic point clouds (no CARLA server)."""
import math

import numpy as np
import pytest

from faultline.ego.lidar_tracker import LEN_PRIOR, WID_PRIOR, LidarTracker, cluster_bev, fit_box


def car_points(s_c, l_c, sensor=(0.0, 0.0), L=4.7, W=1.9, n=80):
    """Points on the faces of a car-sized box that a sensor at `sensor` can see (rear/front face + near side)."""
    ss, ls = sensor
    hs = np.linspace(0.5, 1.4, 4)
    face_s = s_c - L / 2 if s_c > ss else s_c + L / 2
    pts = [(face_s, l, h) for l in np.linspace(l_c - W / 2, l_c + W / 2, n // 4) for h in hs]
    if abs(l_c - ls) > W / 2:
        side_l = l_c - W / 2 if l_c > ls else l_c + W / 2
        pts += [(s, side_l, h) for s in np.linspace(s_c - L / 2, s_c + L / 2, n // 4) for h in hs]
    return np.array(pts)


def ground(n=200, rng=np.random.default_rng(0)):
    return np.column_stack([rng.uniform(-10, 50, n), rng.uniform(-6, 6, n), rng.normal(0, 0.03, n)])


def test_cluster_separates_two_cars_and_drops_specks():
    a, b = car_points(15, 0), car_points(15, 3.5)
    speck = np.array([[30.0, -5.0], [30.1, -5.0]])
    cl = cluster_bev(np.vstack([a[:, :2], b[:, :2], speck]))
    assert len(cl) == 2 and sorted(len(c) for c in cl) == sorted([len(a), len(b)])


def test_fit_box_anchors_on_the_near_faces():
    s, l, L, W = fit_box(car_points(15.0, 0.0)[:, :2], (0.0, 0.0))  # rear face only, straddling the sensor line
    assert abs(L - LEN_PRIOR) < 1e-9 and abs(s - (15.0 - 4.7 / 2 + LEN_PRIOR / 2)) < 1e-9 and abs(l) < 1e-9
    s, l, L, W = fit_box(car_points(15.0, 3.5)[:, :2], (0.0, 0.0))  # rear + right side visible
    # anchored on the near (rear) face with the prior length: the far end flickers with the side returns
    assert L == LEN_PRIOR and W == WID_PRIOR and abs(l - 3.5) < 1e-9 and abs(s - (15.0 - 2.35 + LEN_PRIOR / 2)) < 1e-9
    s, l, L, W = fit_box(car_points(20.0, 3.5, L=12.0)[:, :2], (0.0, 0.0))  # a bus: clearly longer than the prior
    assert abs(L - 12.0) < 1e-9 and abs(s - 20.0) < 1e-9


def test_tracker_velocity_yaw_and_confirmation():
    dt = 0.05
    tr = LidarTracker(dt, l_max=6.0, to_world=lambda s, l: (s, -l, 0.0, 0.0))  # route along +x, left = -y
    ego_s, adv_s, adv_l = 0.0, 15.0, 3.5
    for k in range(40):  # ego 8 m/s, car 9 m/s in the left lane
        ego_s, adv_s = ego_s + 8 * dt, adv_s + 9 * dt
        out = tr.update(np.vstack([car_points(adv_s, adv_l, (ego_s + 1.5, 0)), ground() + [ego_s, 0, 0]]),
                        (ego_s + 1.5, 0.0), (ego_s, 0.0))
        if k < 2:
            assert out == []  # tentative until 3 hits
    assert len(out) == 1
    t = out[0]
    assert abs(t.speed - 9.0) < 0.3 and abs(t.s - adv_s) < 0.3 and abs(t.l - 3.5) < 0.1
    assert abs(t.yaw) < 3 and abs(t.y + 3.5) < 0.1 and t.type_id == "lidar_track"
    pytest.importorskip("carla")  # the duck-typed carla accessors need the wheel (absent on macOS)
    assert abs(t.get_velocity().length() - t.speed) < 1e-6 and abs(t.bounding_box.extent.x - t.length / 2) < 1e-5
    for k in range(10):  # cut towards the ego lane at 2 m/s lateral
        ego_s, adv_s, adv_l = ego_s + 8 * dt, adv_s + 9 * dt, adv_l - 2.0 * dt
        out = tr.update(car_points(adv_s, adv_l, (ego_s + 1.5, 0)), (ego_s + 1.5, 0.0), (ego_s, 0.0))
    t = out[0]
    assert t.id == 1 and t.vl < -1.5 and t.yaw > 5  # moving right (towards the ego lane) = clockwise = positive yaw


def test_tracker_ignores_ego_body_and_ground_and_drops_lost_tracks():
    tr = LidarTracker(0.05, l_max=6.0)
    body = car_points(0.0, 0.0, sensor=(1.5, 0))
    for _ in range(5):
        assert tr.update(np.vstack([body, ground()]), (1.5, 0.0), (0.0, 0.0)) == []
    for _ in range(4):
        out = tr.update(car_points(20, 0), (1.5, 0.0))
    assert len(out) == 1
    for _ in range(6):
        out = tr.update(np.zeros((0, 3)), (1.5, 0.0))
    assert out == [] and tr.tracks == []


def test_slow_object_snaps_to_lane_heading():
    tr = LidarTracker(0.05, l_max=6.0, to_world=lambda s, l: (s, -l, 0.0, 30.0))
    rng = np.random.default_rng(1)
    for _ in range(20):  # stopped car, centre jitter of 5 cm
        out = tr.update(car_points(15 + rng.normal(0, 0.05), 0.5 + rng.normal(0, 0.05)), (0.0, 0.0))
    assert abs(out[0].yaw - 30.0) < 1e-9 and math.isclose(out[0].rel_yaw_deg, 0.0, abs_tol=1e-9)


def test_roi_drops_roadside_clutter_but_keeps_cars():
    tr = LidarTracker(0.05, l_min=-1.6, l_max=5.55)
    pole = np.array([[8.0 + 0.1 * i, -1.58, 0.5 + 0.1 * j] for i in range(5) for j in range(10)])  # at the kerb
    for _ in range(4):
        out = tr.update(np.vstack([pole, car_points(15, 3.5)]), (1.5, 0.0))
    assert len(out) == 1 and abs(out[0].l - 3.5) < 0.1
