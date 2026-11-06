"""Vendored PDM-Lite decision logic on duck-typed tracks. Uses only carla's client-side math types, no server."""
import pytest

carla = pytest.importorskip("carla")

from faultline.ego.lidar_tracker import Track  # noqa: E402
from faultline.ego.pdm_lite import PDMLite  # noqa: E402

ROUTE = [(x, 0.0, 0.0) for x in range(-10, 200, 2)]  # straight along +x; CARLA left of the route = -y
EGO_BB = carla.BoundingBox(carla.Location(), carla.Vector3D(2.45, 1.05, 0.75))


def track(x, y, speed, yaw=0.0, i=1):
    return Track(id=i, s=x, l=-y, x=x, y=y, z=0.0, yaw=yaw, speed=speed, length=4.7, width=1.9)


def step(p, tracks, speed=8.0, n=1):
    for _ in range(n):
        c = p.run_step(carla.Transform(carla.Location(0, 0, 0), carla.Rotation(yaw=0)), speed, tracks)
    return c


def test_free_road_holds_target_speed():
    p = PDMLite(ROUTE, EGO_BB, 8.0)
    c = step(p, [])
    assert c.brake == 0 and 0 < c.throttle <= 1 and abs(c.steer) < 0.01 and p.target_speed_out == 8.0
    assert step(PDMLite(ROUTE, EGO_BB, 8.0), [], speed=4.0).throttle == 1.0


def test_stopped_car_in_lane_brakes():
    p = PDMLite(ROUTE, EGO_BB, 8.0)
    c = step(p, [track(14.0, 0.0, 0.0)])
    assert c.brake == 1.0 and c.throttle == 0 and p.leading_ids == [1]


def test_slower_leader_reduces_target_speed_by_idm():
    p = PDMLite(ROUTE, EGO_BB, 8.0)
    step(p, [track(25.0, 0.2, 6.0)])
    assert p.leading_ids == [1] and p.target_speed_out < 8.0


def test_adjacent_lane_car_is_ignored_until_it_cuts_in():
    p = PDMLite(ROUTE, EGO_BB, 8.0)
    c = step(p, [track(12.0, -3.5, 9.0)])
    assert c.brake == 0 and p.leading_ids == [] and not p.vehicle_hazard
    # slower car heading 30 deg clockwise (towards the ego lane, +y): its forecast box crosses the ego's path
    p = PDMLite(ROUTE, EGO_BB, 8.0)
    c = step(p, [track(9.0, -3.5, 4.0, yaw=30.0)])
    assert c.brake == 1.0 and p.vehicle_hazard and p.leading_ids == []
    # once its centre is within 2.5 m of the route and its yaw within 35 deg it is the leader (IDM)
    p = PDMLite(ROUTE, EGO_BB, 8.0)
    step(p, [track(12.0, -1.5, 6.0, yaw=20.0)])
    assert p.leading_ids == [1] and p.target_speed_out < 8.0
