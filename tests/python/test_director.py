import json

import numpy as np
import pytest

from faultline import director, stitch

pytest.importorskip("numpy")
try:
    director._cairo()
except ImportError:  # pragma: no cover - Ubuntu's python3-cairo missing
    pytest.skip("pycairo not available", allow_module_level=True)

DEC = {"cp": 3, "sim_time_s": 5.0, "phase": "squeeze", "source": "0g", "reason": "ok",
       "action": "A:BRAKE_HARD B:CUT_IN_AGGRESSIVE C:KEEP_LANE D:KEEP_LANE",
       "control": {c: {"control_accel_mps2": 0.0} for c in "ABCD"}, "request_id": "1234abcd-0000-0000-0000-00000000beef",
       "provider": "0xABCDEF0123456789", "latency_ms": 2310, "raw_sha256": "f" * 64, "zg_res_key": "k" * 40,
       "content": '{"phase":"squeeze","A":"BRAKE_HARD","B":"CUT_IN_AGGRESSIVE","C":"KEEP_LANE","D":"KEEP_LANE",'
                  '"why":"box the ego in"}'}
PLAN = {"plan": {"name": "Box-in then brake", "summary": "B cuts in, A brakes", "roles": {c: "r" for c in "ABCD"},
                 "phases": [{"name": "bait", "from_s": 2, "intent": "x"}]}, "request_id": "p", "latency_ms": 30000,
        "content_sha256": "a" * 64, "reasoning_chars": 12000}


def _state(**kw):
    cam = np.full((540, 960, 4), 90, np.uint8)
    st = {"chase": cam, "drone": cam, "points": np.array([[10.0, 0.0, -0.5, 1.0], [5.0, -3.0, -1.9, 1.0]], np.float32),
          "gt": [{"id": "A", "fwd": 20.0, "right": 0.0, "yaw": 0.0, "length": 4.9, "width": 2.0}],
          "tracks": [{"id": 4, "fwd": 19.5, "right": 0.1, "yaw": 0.0, "length": 4.5, "width": 1.9, "speed": 7.9}],
          "lanes": [[(0.0, -1.75), (40.0, -1.75)]], "drone_labels": [(1400, 300, "A BRAKE_HARD", (230, 40, 40))],
          "decision": DEC, "plan": PLAN, "horizon": 12.0,
          "metrics": {"t": 5.0, "ego_v": 7.5, "gap_lidar": 12.0, "gap_gt": 11.8, "ttc": 3.0, "ccs_max": 0.4,
                      "brake": 0.3, "collision": False, "guarded": ["D"]},
          "history": [{"t": 0.1 * i, "gap_lidar": 20 - i * 0.1, "gap_gt": 20 - i * 0.1, "ego_v": 8.0, "brake": 0.0}
                      for i in range(50)]}
    st.update(kw)
    return st


def _region(buf, r):
    x, y, w, h = r
    return buf[y:y + h, x:x + w, :3]


def test_render_shape_and_panels():
    buf = director.render(_state())
    assert buf.shape == (1080, 1920, 4) and buf.dtype == np.uint8
    for r in (director.BEV, director.ZG, director.MET):
        assert _region(buf, r).std() > 5  # panel drawn, not flat
    # chase camera copied into the top-left (away from the caption/legend)
    assert (_region(buf, (400, 300, 200, 200)) == 90).all()
    # a LiDAR point above the ground at 10 m ahead lands at its BEV pixel
    u, v = director.bev_px(10.0 + 0.0, 0.0)
    assert tuple(buf[int(v), int(u), :3]) != (18, 14, 12)


def test_text_renders_and_changes_with_content():
    a = director.render(_state())
    b = director.render(_state(decision={**DEC, "content": DEC["content"].replace("box the ego in", "pincer now")}))
    zg = director.ZG
    assert (_region(a, zg) != _region(b, zg)).any()  # the why text is drawn
    halt = director.render(_state(decision={**DEC, "source": "none", "reason": "out_of_set", "action": None}))
    x, y, w, h = director.ZG
    assert (_region(halt, (x, y + 100, w, 60))[..., 2] > 150).any()  # red SAFE_HALT banner


def test_cards():
    base = director.render(_state())
    c = director.decision_card(base, DEC, 0.5)
    assert c.shape == base.shape and (c != base).any()
    p = director.plan_card(base, PLAN, 0.0)
    f = director.plan_card(base, {"plan": None, "plan_reason": "bad_plan"}, 0.0)
    assert (p != f).any()


def test_ffmpeg_cmd():
    c = director.ffmpeg_cmd("x.mp4")
    assert c[c.index("-s") + 1] == "1920x1080" and c[c.index("-pix_fmt") + 1] == "bgr0" and c[-1] == "x.mp4"


def test_parse_windows_and_crop():
    tree = '''
        0x3600016 "ws://localhost:8765 – Lichtblick — Mozilla Firefox": ("Navigator" "firefox_firefox")  640x842+0+0  +1280+28
        0x2e00092 "viz/faultline.rviz* - RViz": ("rviz2" "rviz2")  1280x416+5+29  +5+813
           0x2e00013 "rviz2": ("rviz2" "rviz2")  1248x324+16+62  +21+875
'''
    assert stitch.parse_windows(tree) == {"hmi": [1280, 28, 640, 842], "rviz": [5, 813, 1280, 416]}
    c = stitch.crop_cmd("d.mkv", [5, 813, 1280, 416], 1280, 288, skip_top=49)
    assert "crop=1280:288:5:862,scale=1280:288" in c  # minus the toolbar, clamped above the dock (y < 1150)
    assert "-copyts" in c and c[-1] == "-"


def test_desk_cmd_and_index():
    c = stitch.desk_cmd("d.mkv")
    assert c[c.index("-i") + 1] == ":2" and "-copyts" in c and c[-1] == "d.mkv"
    t = [10.0, 10.05, 10.1, 13.0]  # a 0G pause between 10.1 and 13.0
    assert stitch.desk_index(t, 9.0) == 0 and stitch.desk_index(t, 10.07) == 1 and stitch.desk_index(t, 12.0) == 2
    e = stitch.encode_cmd("s.mp4")
    assert e[e.index("-s") + 1] == "1920x1008"


def test_decisions_html(tmp_path):
    obs = {"sim_time_s": 5.0, "ego_speed_mps": 7.5, "ego_accel_mps2": -1.0,
           "cars": {c: {"role": "r", "position": "ego lane, ahead", "gap_m": 10.0, "speed_mps": 8.0, "ttc_s": None,
                        "mode": "KEEP_LANE", "available_actions": ["KEEP_LANE"]} for c in "ABCD"},
           "forecast": [{"A": "BRAKE_HARD", "B": "CUT_IN_AGGRESSIVE", "C": "KEEP_LANE", "min_gap_in_path_m": 3.0,
                         "min_ttc_s": 1.2, "nominal_ego_decel_mps2": 2.0, "collision": False,
                         "adversaries_touch": False}]}
    (tmp_path / "decisions.jsonl").write_text(json.dumps({**DEC, "observation": obs}) + "\n")
    (tmp_path / "manifest.json").write_text(json.dumps({"decisions_0g": 1, "decisions_halt": 0}))
    (tmp_path / "metrics.json").write_text(json.dumps({"ground_truth": {"ccs": 0.5}}))
    (tmp_path / "plan.json").write_text(json.dumps({**PLAN, "content": '{"name":"<b>x</b>"}'}))
    page = director.decisions_html(tmp_path).read_text()
    assert DEC["request_id"] in page and "box the ego in" in page and "&lt;b&gt;x&lt;/b&gt;" in page
    assert "background:#2d3a20" in page  # the chosen forecast row is highlighted
