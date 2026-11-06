from dataclasses import replace

from faultline.config import DEMO, IdmParams
from faultline.controller import IdmFollower, LeadLongitudinal
from faultline.world import KinematicWorld

DT = 0.05


def test_idm_holds_desired_speed_when_free():
    f, v = IdmFollower(IdmParams(), DT), 15.0
    for _ in range(600):
        v += f.accel(v, 500.0, 20.0) * DT
    assert abs(v - 20.0) < 0.2


def test_idm_brakes_when_closing():
    assert IdmFollower(IdmParams(), DT).accel(20.0, 15.0, 10.0) < -2.0


def test_reaction_delay_is_12_ticks():
    f = IdmFollower(IdmParams(), DT)
    out = [f.observe(float(i), float(i)) for i in range(30)]
    assert all(out[i] == (i - 12.0, i - 12.0) for i in range(12, 30))


def test_lead_controller_maintain_and_brake():
    c = LeadLongitudinal(DT)
    assert c.step(19.0, 20.0) == 0.8 and c.step(25.0, 20.0) == -1.0
    c.set_decel(2.5)
    assert c.step(10.0, 20.0) == -2.5 and c.step(0.04, 20.0) == 0.0


def test_kinematic_world_maintain_then_brake_hard():
    w = KinematicWorld(DEMO); w.reset(DEMO); pre = [w.tick() for _ in range(60)]
    # IDM eases off when it starts at its own desired speed, so the gap drifts open by ~2 m in 3 s
    assert all(abs(s.gt_gap - 35.0) < 3.0 for s in pre)
    w.set_lead_decel(6.0); st = [w.tick() for _ in range(40)]
    assert st[-1].lead_v < st[0].lead_v - 10 and st[-1].gt_gap < 30 and st[-1].lidar_gap == st[-1].gt_gap


def test_kinematic_world_is_deterministic():
    def run():
        w = KinematicWorld(DEMO); w.reset(DEMO); out = []
        for i in range(200):
            if i == 60: w.set_lead_decel(6.0)
            if i == 120: w.set_lead_decel(None)
            out.append(w.tick())
        return out
    assert run() == run()


def test_brake_hard_is_clamped_by_friction():
    s = replace(DEMO, friction_mu=0.3)
    w = KinematicWorld(s); w.reset(s); w.tick(); w.set_lead_decel(6.0)
    a, b = w.tick(), w.tick()
    assert abs((a.lead_v - b.lead_v) / DT - 0.8 * 9.81 * 0.3) < 1e-6 and abs(b.lead_a + 0.8 * 9.81 * 0.3) < 1e-9
