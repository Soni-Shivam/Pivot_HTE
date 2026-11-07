"""Sim-time multi-panel video of a CARLA swarm episode, written straight to ffmpeg (display only, never feeds back).

One 1920x1080 frame per simulation tick (20 fps = real sim time, no frozen frames):
  chase camera | top-down drone camera following the group
  LiDAR bird's-eye (numpy) | 0G panel (latest decision verbatim, plan, request id, provider, latency) | metrics
When a 0G call happened, a 1.25 s card with the raw JSON the model returned is inserted (the sim was paused for that
long in real time); a plan card opens the video and a result card closes it. Each output frame's wall-clock time goes
to director_frames.json so faultline.stitch can put the desktop (RViz/HMI) capture of that same moment next to it.

Text and vector drawing use pycairo from Ubuntu's python3-cairo (no PIL/cv2 here, ffmpeg has no drawtext); like
faultline.rosbridge, Ubuntu's dist-packages is appended after the venv for that one import.
"""
import html
import json
import math
import queue
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import numpy as np

W, H, FPS = 1920, 1080, 20
CHASE, DRONE = (0, 0, 960, 540), (960, 0, 960, 540)
BEV, ZG, MET = (0, 540, 540, 540), (540, 540, 900, 540), (1440, 540, 480, 540)
CAM_W, CAM_H, DRONE_FOV, DRONE_Z = 960, 540, 80.0, 38.0
CARD_FRAMES, PLAN_FRAMES, END_FRAMES = 25, 90, 60
BEV_PX_M, BEV_BACK_M = 11.0, 9.0  # 540 px = 49 m: 9 m behind the LiDAR, 40 m ahead, +-24.5 m sideways
COLORS = {"A": (230, 40, 40), "B": (245, 195, 0), "C": (40, 120, 245), "D": (210, 60, 220), "ego": (40, 220, 120)}
BLUEPRINTS = {"A": ("vehicle.dodge.charger", "230,40,40"), "B": ("vehicle.taxi.ford", None),
              "C": ("vehicle.mini.cooper", "40,120,245"), "D": ("vehicle.nissan.patrol", "210,60,220")}
COLOR_NAMES = {"A": "red", "B": "yellow taxi", "C": "blue", "D": "magenta"}


def _cairo():
    try:
        import cairo
    except ImportError:
        sys.path.append("/usr/lib/python3/dist-packages")  # shortcut: Ubuntu's python3-cairo, same 3.12 ABI as the venv
        import cairo
    return cairo


def ffmpeg_cmd(path, w=W, h=H, fps=FPS) -> list:
    return ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr0", "-s", f"{w}x{h}",
            "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", str(path)]


def short(x, n=8):
    return "-" if not x else (x if len(x) <= 2 * n + 1 else f"{x[:n]}…{x[-4:]}")


def turbo(v: np.ndarray) -> np.ndarray:
    """0..1 -> RGB uint8 (polynomial approximation of the turbo colormap)."""
    v = np.clip(v, 0, 1)[:, None]
    c = np.array([[0.1357, 4.5974, -42.3277, 130.5887, -150.5666, 58.1375],
                  [0.0914, 2.1856, 4.8052, -14.0195, 4.2109, 2.7747],
                  [0.1067, 12.5925, -60.1097, 109.0745, -88.5066, 26.8183]])
    rgb = sum(c[:, i][None, :] * v ** i for i in range(6))
    return (np.clip(rgb, 0, 1) * 255).astype(np.uint8)


class Painter:
    """cairo on the frame buffer (BGRX memory = cairo RGB24 on little-endian)."""

    def __init__(self, buf: np.ndarray):
        cairo = _cairo()
        self.cairo = cairo
        self.surf = cairo.ImageSurface.create_for_data(memoryview(buf), cairo.FORMAT_RGB24, buf.shape[1], buf.shape[0],
                                                       buf.shape[1] * 4)
        self.cr = cairo.Context(self.surf)

    def rgb(self, c, a=1.0):
        self.cr.set_source_rgba(c[0] / 255, c[1] / 255, c[2] / 255, a)

    def rect(self, x, y, w, h, c, a=1.0, fill=True, lw=2.0):
        self.rgb(c, a)
        self.cr.rectangle(x, y, w, h)
        if fill:
            self.cr.fill()
        else:
            self.cr.set_line_width(lw)
            self.cr.stroke()

    def text(self, x, y, s, size=18, c=(235, 235, 235), bold=False, mono=False, a=1.0) -> float:
        cr = self.cr
        cr.select_font_face("DejaVu Sans Mono" if mono else "DejaVu Sans", self.cairo.FONT_SLANT_NORMAL,
                            self.cairo.FONT_WEIGHT_BOLD if bold else self.cairo.FONT_WEIGHT_NORMAL)
        cr.set_font_size(size)
        self.rgb(c, a)
        cr.move_to(x, y + size)
        cr.show_text(str(s))
        return cr.text_extents(str(s)).x_advance

    def lines(self, x, y, lines, size=16, c=(235, 235, 235), mono=False, gap=1.3, bold=False) -> float:
        for ln in lines:
            self.text(x, y, ln, size, c, bold=bold, mono=mono)
            y += size * gap
        return y

    def poly(self, pts, c, lw=2.0, a=1.0, close=False, dash=None):
        if len(pts) < 2:
            return
        cr = self.cr
        self.rgb(c, a)
        cr.set_line_width(lw)
        cr.set_dash(dash or [])
        cr.move_to(*pts[0])
        for p in pts[1:]:
            cr.line_to(*p)
        if close:
            cr.close_path()
        cr.stroke()
        cr.set_dash([])

    def flush(self):
        self.surf.flush()


def wrap(s, n):
    return textwrap.wrap(str(s or ""), n) or [""]


# ---- panels --------------------------------------------------------------------------------------------------------
def _box_px(fwd, right, yaw_rel_deg, length, width):
    """Corners of a box (ego frame metres: fwd, right) in BEV panel pixels (forward = up)."""
    r = math.radians(yaw_rel_deg)
    out = []
    for dl, dw in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
        f = fwd + dl * length / 2 * math.cos(r) - dw * width / 2 * math.sin(r)
        s = right + dl * length / 2 * math.sin(r) + dw * width / 2 * math.cos(r)
        out.append(bev_px(f, s))
    return out


def bev_px(fwd, right):
    x0, y0, w, h = BEV
    return x0 + w / 2 + right * BEV_PX_M, y0 + h - (fwd + BEV_BACK_M) * BEV_PX_M


def draw_bev(buf, p: Painter, st: dict):
    x0, y0, w, h = BEV
    buf[y0:y0 + h, x0:x0 + w, :3] = (18, 14, 12)
    pts = st.get("points")
    if pts is not None and len(pts):
        u = (x0 + w / 2 + pts[:, 1] * BEV_PX_M).astype(int)  # sensor frame: x forward, y right (CARLA)
        v = (y0 + h - (pts[:, 0] + BEV_BACK_M) * BEV_PX_M).astype(int)
        ok = (u >= x0) & (u < x0 + w) & (v >= y0) & (v < y0 + h)
        z = pts[ok, 2]
        col = turbo((z + 1.6) / 2.6)
        col[z < -1.6] = (70, 70, 70)  # ground returns
        buf[v[ok], u[ok], 0], buf[v[ok], u[ok], 1], buf[v[ok], u[ok], 2] = col[:, 2], col[:, 1], col[:, 0]
    for ln in st.get("lanes", []):
        p.poly([bev_px(f, r) for f, r in ln], (200, 200, 215), 1.5, 0.8, dash=[6, 6])
    for g in st.get("gt", []):
        p.poly(_box_px(g["fwd"], g["right"], g["yaw"], g["length"], g["width"]), COLORS.get(g["id"], (200, 200, 200)),
               2.0, 0.9, close=True, dash=[4, 3])
    for t in st.get("tracks", []):
        p.poly(_box_px(t["fwd"], t["right"], t["yaw"], t["length"], t["width"]), (40, 230, 255), 2.5, close=True)
        u, v = bev_px(t["fwd"] + t["length"] / 2, t["right"])
        p.text(u + 6, v - 18, f"#{t['id']} {t['speed']:.1f} m/s", 13, (40, 230, 255), bold=True)
    p.poly(_box_px(-0.0, 0.0, 0.0, 4.9, 2.1), COLORS["ego"], 3.0, close=True)
    p.rect(x0, y0, w, 30, (0, 0, 0), 0.6)
    p.text(x0 + 10, y0 + 6, "LiDAR bird's-eye  ·  what the AV stack sees", 15, bold=True)
    p.text(x0 + 10, y0 + h - 24, "cyan: LiDAR tracks   dashed: ground truth   colour: height", 12, (180, 180, 180))


def draw_zg(p: Painter, st: dict):
    x0, y0, w, h = ZG
    p.rect(x0, y0, w, h, (14, 18, 30))
    p.rect(x0, y0, w, 30, (60, 40, 140))
    p.text(x0 + 12, y0 + 6, "0G Router · 0gm-1.0-35b-a3b · private tier · one call drives every car", 15, bold=True)
    plan = (st.get("plan") or {}).get("plan")
    y = y0 + 40
    if plan:
        p.text(x0 + 12, y, "PLAN", 14, (170, 150, 255), bold=True)
        p.text(x0 + 70, y - 3, plan.get("name", ""), 20, (255, 255, 255), bold=True)
        tc = plan.get("target_cell")
        if isinstance(tc, dict):  # campaign: the archive cell the strategist aimed at
            p.text(x0 + 520, y, f"target cell {tc.get('pressure')} × {tc.get('first_threat')}", 15, (170, 150, 255))
        y += 28
    d = st.get("decision")
    if d is None:
        p.text(x0 + 12, y + 10, "run-up: no decision yet (first checkpoint at 2.0 s)", 18, (200, 200, 200))
        return
    halt = d.get("source") != "0g"
    p.text(x0 + 12, y, f"checkpoint {d['cp']}  ·  t = {d['sim_time_s']:.1f} s  ·  phase: {d.get('phase') or '-'}",
           16, (200, 220, 255))
    y += 28
    if halt:
        p.rect(x0 + 12, y, w - 24, 46, (170, 20, 20))
        p.text(x0 + 24, y + 10, f"SAFE_HALT — every car brakes ({d.get('reason')})", 22, bold=True)
        y += 60
    acts = dict(a.split(":", 1) for a in (d.get("action") or "").split()) if not halt else {}
    roles = (plan or {}).get("roles", {})
    for c, ctl in (d.get("control") or {}).items():
        col = COLORS.get(c, (200, 200, 200))
        p.rect(x0 + 12, y + 2, 22, 22, col)
        p.text(x0 + 42, y + 1, c, 20, col, bold=True)
        p.text(x0 + 70, y + 1, acts.get(c, "SAFE_HALT"), 20, (255, 255, 255), bold=True, mono=True)
        p.text(x0 + 310, y + 4, (roles.get(c) or COLOR_NAMES.get(c, ""))[:52], 15, (190, 190, 190))
        y += 30
    why = ""
    if d.get("content"):
        try:
            why = json.loads(d["content"]).get("why", "")
        except (ValueError, AttributeError):
            why = ""
    if why:
        y = p.lines(x0 + 12, y + 8, [f"why: “{ln}" if i == 0 else ln for i, ln in enumerate(wrap(why + "”", 80))],
                    16, (255, 230, 150))
    foot = y0 + h - 58
    p.rect(x0, foot - 6, w, 64, (0, 0, 0), 0.5)
    p.text(x0 + 12, foot, f"request {d.get('request_id') or '-'}", 14, (180, 180, 180), mono=True)
    p.text(x0 + 12, foot + 20, f"provider {short(d.get('provider'), 10)}   latency {d.get('latency_ms', 0) / 1000:.2f} s"
           f" real time   raw sha256 {short(d.get('raw_sha256'), 6)}", 14, (180, 180, 180), mono=True)
    p.text(x0 + 12, foot + 40, "sim paused during the call (synchronous mode) · not anchored", 13, (140, 140, 140))


def _spark(p, x, y, w, h, series, horizon, colors, labels, vmax):
    p.rect(x, y, w, h, (30, 30, 36))
    for s, c in zip(series, colors):
        pts = [(x + w * t / horizon, y + h - h * min(max(v, 0), vmax) / vmax) for t, v in s if v is not None]
        p.poly(pts, c, 2.0)
    lx = x + 6
    for lab, c in zip(labels, colors):
        lx += p.text(lx, y + 4, lab, 12, c, bold=True) + 12


def draw_metrics(p: Painter, st: dict):
    x0, y0, w, h = MET
    m = st.get("metrics", {})
    p.rect(x0, y0, w, h, (16, 16, 20))
    p.rect(x0, y0, w, 30, (30, 30, 40))
    p.text(x0 + 12, y0 + 6, f"metrics  ·  t = {m.get('t', 0):.2f} s (sim)", 15, bold=True)
    f = lambda v, u: "  --" if v is None else f"{v:5.2f}{u}"
    rows = [("ego speed", f(m.get("ego_v"), " m/s")), ("LiDAR gap", f(m.get("gap_lidar"), " m")),
            ("true gap", f(m.get("gap_gt"), " m")), ("TTC (true)", f(m.get("ttc"), " s")),
            ("CCS so far", f(m.get("ccs_max"), "")), ("guarded cars", " ".join(m.get("guarded") or []) or "-")]
    y = y0 + 40
    for k, v in rows:
        p.text(x0 + 14, y, k, 16, (170, 170, 170))
        p.text(x0 + 200, y - 2, v, 20, (255, 255, 255), bold=True, mono=True)
        y += 28
    p.text(x0 + 14, y + 2, "brake", 16, (170, 170, 170))
    p.rect(x0 + 200, y + 4, 240, 18, (50, 50, 50))
    p.rect(x0 + 200, y + 4, 240 * min(max(m.get("brake", 0.0), 0), 1), 18, (240, 60, 60))
    y += 34
    hist, hz = st.get("history", []), st.get("horizon", 12.0)
    _spark(p, x0 + 14, y, w - 28, 92, [[(r["t"], r["gap_lidar"]) for r in hist], [(r["t"], r["gap_gt"]) for r in hist]],
           hz, [(40, 230, 255), (255, 170, 60)], ["LiDAR gap", "true gap (0-30 m)"], 30.0)
    _spark(p, x0 + 14, y + 102, w - 28, 72, [[(r["t"], r["ego_v"]) for r in hist], [(r["t"], r["brake"] * 10) for r in hist]],
           hz, [(120, 255, 140), (240, 60, 60)], ["ego speed", "brake (0-10 m/s, 0-1)"], 10.0)
    if m.get("collision"):
        p.rect(x0 + 14, y0 + h - 60, w - 28, 44, (220, 0, 0))
        p.text(x0 + 30, y0 + h - 50, "COLLISION", 24, bold=True)


def draw_cam_labels(p: Painter, st: dict):
    p.rect(0, 0, 330, 28, (0, 0, 0), 0.55)
    p.text(10, 5, f"chase camera  ·  sim t = {st.get('metrics', {}).get('t', 0):.2f} s", 15, bold=True)
    p.rect(DRONE[0], 0, 300, 28, (0, 0, 0), 0.55)
    p.text(DRONE[0] + 10, 5, "drone camera  ·  top-down", 15, bold=True)
    for u, v, label, c in st.get("drone_labels", []):
        if DRONE[0] <= u < DRONE[0] + DRONE[2] - 60 and 30 <= v < DRONE[3]:
            tw = len(label) * 8.5 + 10
            p.rect(u + 14, v - 30, tw, 22, (0, 0, 0), 0.65)
            p.text(u + 19, v - 28, label, 14, c, bold=True)
    leg = 70
    p.rect(0, 30, 150, 78, (0, 0, 0), 0.55)
    for c, name in COLOR_NAMES.items():  # colour legend under the chase caption
        p.rect(10, leg - 32, 14, 14, COLORS[c])
        p.text(30, leg - 35, f"{c} {name}", 13)
        leg += 18


def render(st: dict) -> np.ndarray:
    """One mosaic frame from a plain-data frame state (testable without CARLA)."""
    buf = np.zeros((H, W, 4), np.uint8)
    for key, (x, y, w, h) in (("chase", CHASE), ("drone", DRONE)):
        img = st.get(key)
        if img is not None:
            buf[y:y + h, x:x + w] = img[:h, :w]
        else:
            buf[y:y + h, x:x + w, :3] = 40
    p = Painter(buf)
    draw_bev(buf, p, st)
    draw_zg(p, st)
    draw_metrics(p, st)
    draw_cam_labels(p, st)
    if st.get("metrics", {}).get("collision"):
        p.rect(4, 4, W - 8, H - 8, (255, 0, 0), fill=False, lw=8)
    p.flush()
    return buf


def card(base: np.ndarray, title: str, sub: str, body: list, foot: list, progress: float, accent=(120, 90, 255)):
    """A translucent card over a dimmed frame."""
    buf = (base.astype(np.uint16) * 35 // 100).astype(np.uint8)
    p = Painter(buf)
    x, y, w, h = 160, 90, W - 320, H - 180
    p.rect(x, y, w, h, (12, 12, 22), 0.94)
    p.rect(x, y, w, 8, accent)
    p.text(x + 40, y + 34, title, 40, (255, 255, 255), bold=True)
    p.text(x + 40, y + 92, sub, 22, (200, 200, 255))
    yy = y + 140
    for ln in body:
        if yy > y + h - 120:
            break
        if isinstance(ln, tuple):  # (text, colour, size, bold, mono)
            s, c, size, bold, mono = ln
        else:
            s, c, size, bold, mono = ln, (230, 230, 230), 20, False, True
        p.text(x + 40, yy, s, size, c, bold=bold, mono=mono)
        yy += size * 1.35
    fy = y + h - 100
    for ln in foot:
        p.text(x + 40, fy, ln, 16, (170, 170, 170), mono=True)
        fy += 22
    p.rect(x + 40, y + h - 26, (w - 80) * min(max(progress, 0), 1), 6, accent)
    p.flush()
    return buf


def decision_card(base, d: dict, progress: float):
    ok = d.get("source") == "0g"
    raw = d.get("content") or f"(no content: {d.get('reason')})"
    try:
        raw_lines = json.dumps(json.loads(raw), indent=2).splitlines() if raw.strip().startswith("{") else wrap(raw, 90)
    except ValueError:
        raw_lines = wrap(raw, 90)
    lines = [l[:110] for l in raw_lines]
    body = [("the model returned, verbatim (pretty-printed):", (170, 170, 200), 18, False, False)] + lines
    if not ok:
        body.append((f"parse: {d.get('reason')}  →  SAFE_HALT for every car (no substitute decision)",
                     (255, 90, 90), 22, True, False))
    foot = [f"request id {d.get('request_id') or '-'}    provider {d.get('provider') or '-'}",
            f"Zg-Res-Key {short(d.get('zg_res_key'), 12)}    raw sha256 {d.get('raw_sha256') or '-'}"]
    return card(base, f"0G deciding…  checkpoint {d.get('cp')}",
                f"{d.get('latency_ms', 0) / 1000:.2f} s real time · simulation paused (synchronous mode) · "
                f"private tier, non-thinking", body, foot, progress, (120, 90, 255) if ok else (220, 40, 40))


def plan_card(base, pe: dict, progress: float):
    plan = pe.get("plan") or {}
    if not plan:
        body = [(f"planner failed ({pe.get('plan_reason')}): every car SAFE_HALTs at the first checkpoint",
                 (255, 90, 90), 24, True, False)]
    else:
        body = [(plan.get("name", ""), (255, 255, 255), 44, True, False), ("", (0, 0, 0), 8, False, False)]
        body += [(ln, (220, 220, 240), 22, False, False) for ln in wrap(plan.get("summary"), 95)]
        body.append(("", (0, 0, 0), 8, False, False))
        for c, r in (plan.get("roles") or {}).items():
            body.append((f"{c} ({COLOR_NAMES.get(c, '')}): {r}", COLORS.get(c, (220, 220, 220)), 22, True, False))
        body.append(("", (0, 0, 0), 8, False, False))
        for ph in plan.get("phases") or []:
            body.append((f"from {ph.get('from_s', '?')} s  {ph.get('name', '')}: {ph.get('intent', '')}"[:120],
                         (200, 200, 200), 19, False, False))
    rc = pe.get("reasoning_chars")
    foot = [f"request id {pe.get('request_id') or '-'}    provider {pe.get('provider') or '-'}",
            f"plan sha256 {pe.get('content_sha256') or '-'}"]
    return card(base, "0G strategist: the attack plan",
                f"thinking mode · {pe.get('latency_ms', 0) / 1000:.1f} s real time"
                + (f" · {rc:,} reasoning chars" if rc else "") + " · written before the first tick", body, foot,
                progress, (170, 120, 255))


def result_extras(metrics: dict | None, pe: dict | None) -> dict:
    """Extended ground-truth metrics, plan and behaviour cell for the result card (empty when unavailable)."""
    x, out = (metrics or {}).get("extended") or {}, {}
    f = lambda v, fmt: "-" if v is None else fmt.format(v)
    if pe and (pe.get("plan") or {}).get("name"):
        out["plan"] = pe["plan"]["name"]
    if (metrics or {}).get("behaviour_cell"):
        out["behaviour cell"] = " × ".join(metrics["behaviour_cell"])
    if x:
        out.update({"TET / TIT (TTC<1.5 s)": f"{x['tet_s']:.2f} s / {x['tit_s2']:.2f} s²",
                    "min headway / PET": f"{f(x['min_thw_s'], '{:.2f} s')} / {f(x['pet_s'], '{:.2f} s')}",
                    "brake reaction / escape": f"{f(x['brake_reaction_s'], '{:.2f} s')} / "
                                               f"{f(x['escape_space_m'], '{:.1f} m')}",
                    "efficiency / comfort": f"{f(x['ego_efficiency'], '{:.2f}')} / {f(x['comfort_index'], '{:.2f}')}",
                    "0G parse rate / p95": f"{f(x['parse_rate'], '{:.0%}')} / {f(x['latency_p95_ms'], '{:.0f} ms')}",
                    "tokens in/out · cost": f"{x['prompt_tokens'] or 0}/{x['completion_tokens'] or 0} · "
                                            f"{f(x['cost_usd'], '${:.5f}')}"})
    return out


def result_card(base, res: dict, progress: float):
    size = 24 if len(res) <= 9 else 19
    body = [(f"{k:<28}{v}", (235, 235, 235), size, False, True) for k, v in res.items()]
    return card(base, "Episode result (ground truth)", "The AV stack drove on its own LiDAR; the swarm drove on 0G",
                body, ["not anchored · decisions.html lists every call verbatim"], progress, (60, 200, 120))


# ---- CARLA attachment ----------------------------------------------------------------------------------------------
class Director:
    def __init__(self, out_dir: Path):
        self.out_dir = Path(out_dir)
        self.ff, self.wall, self.history, self.last_buf, self.seen = None, [], [], None, None
        self.ccs_max, self.min_ttc, self.min_gap, self.max_decel, self.collided = 0.0, None, None, 0.0, False

    def attach(self, world) -> None:
        import carla
        self.carla, self.world = carla, world
        bl = world.world.get_blueprint_library()

        def cam(fov, tf, parent=None):
            bp = bl.find("sensor.camera.rgb")
            for k, v in {"image_size_x": str(CAM_W), "image_size_y": str(CAM_H), "fov": str(fov)}.items():
                bp.set_attribute(k, v)
            a = world.world.spawn_actor(bp, tf, attach_to=parent) if parent else world.world.spawn_actor(bp, tf)
            world.actors.append(a)
            q = queue.Queue()
            a.listen(q.put)
            return a, q

        # closer and lower than the old 7 m / 90 deg chase view, which made a 3.9 m gap look like 15 m (audit W13)
        self.chase, self.chase_q = cam(70, carla.Transform(carla.Location(x=-5.5, z=2.4), carla.Rotation(pitch=-9)),
                                       world.ego)
        self.drone, self.drone_q = cam(DRONE_FOV, self._drone_tf())
        self.ff = subprocess.Popen(ffmpeg_cmd(self.out_dir / "director.mp4"), stdin=subprocess.PIPE)
        prev = world.on_tick
        world.on_tick = lambda w, s: (prev and prev(w, s), self.on_tick(w, s))

    def _group_arc(self):
        w = self.world
        arcs = [a.arc for a in w.advs.values()] + [w._ego_sl()[0]]
        return (min(arcs) + max(arcs)) / 2

    def _drone_tf(self):
        t = self.world._lateral(self.world._pose(self._group_arc()), 1.75)  # between the two lanes
        self.drone_yaw = t.rotation.yaw - 90  # heading points right in the image, the left lane at the top
        return self.carla.Transform(self.carla.Location(t.location.x, t.location.y, t.location.z + DRONE_Z),
                                    self.carla.Rotation(pitch=-90, yaw=self.drone_yaw))

    @staticmethod
    def _img(q, frame):
        img = q.get(timeout=10.0)
        while img.frame < frame:
            img = q.get(timeout=10.0)
        return np.frombuffer(img.raw_data, dtype=np.uint8).reshape(CAM_H, CAM_W, 4)

    def gather(self, world, st) -> dict:
        frame = world.world.get_snapshot().frame
        chase, drone = self._img(self.chase_q, frame), self._img(self.drone_q, frame)
        dtf = self.drone.get_transform()
        etf = world.ego.get_transform()
        yaw = math.radians(etf.rotation.yaw)
        cy, sy = math.cos(yaw), math.sin(yaw)
        lx, ly = etf.location.x + 1.5 * cy, etf.location.y + 1.5 * sy  # the LiDAR origin

        def ego_frame(x, y):
            dx, dy = x - lx, y - ly
            return dx * cy + dy * sy, -dx * sy + dy * cy  # (forward, right); CARLA y is right

        f = (CAM_W / 2) / math.tan(math.radians(DRONE_FOV) / 2)
        dy_ = math.radians(self.drone_yaw)
        gt, labels = [], []
        acts = {}
        d = world.last_decision
        if d and d.get("action"):
            acts = dict(a.split(":", 1) for a in d["action"].split())
        actors = {"ego": world.ego, "B": world.lead, **{c: a for c, a in world.car_actors.items()}}
        for c, a in actors.items():
            tf, bb = a.get_transform(), a.bounding_box
            ctr = tf.transform(bb.location)
            fw, rt = ego_frame(ctr.x, ctr.y)
            if c != "ego":
                gt.append({"id": c, "fwd": fw, "right": rt, "yaw": tf.rotation.yaw - etf.rotation.yaw,
                           "length": 2 * bb.extent.x, "width": 2 * bb.extent.y})
            rx, ry, depth = ctr.x - dtf.location.x, ctr.y - dtf.location.y, dtf.location.z - ctr.z
            right = rx * math.cos(dy_ + math.pi / 2) + ry * math.sin(dy_ + math.pi / 2)
            up = rx * math.cos(dy_) + ry * math.sin(dy_)
            u, v = DRONE[0] + CAM_W / 2 + f * right / depth, CAM_H / 2 - f * up / depth
            mode = "AV stack" if c == "ego" else (acts.get(c) or world.advs[c].mode)
            labels.append((u, v, f"{'EGO' if c == 'ego' else c} {mode}", COLORS[c]))
        tracks = []
        for t in world.tracks or []:
            fw, rt = ego_frame(t.x, t.y)
            tracks.append({"id": t.id, "fwd": fw, "right": rt, "yaw": t.yaw - etf.rotation.yaw, "length": t.length,
                           "width": t.width, "speed": float(t.speed)})
        lanes, i0 = [], max(int(st.ego_x // 2.0) - 10, 0)
        pts, dirs = world.pts[i0:i0 + 40], world.dirs[i0:i0 + 40]
        for lat in (-1.75, 1.75, 5.25):
            lanes.append([ego_frame(p[0] + lat * dd[1], p[1] - lat * dd[0]) for p, dd in zip(pts, dirs)])
        scan = world.last_scan
        points = np.frombuffer(scan.raw_data, dtype=np.float32).reshape(-1, 4) if scan is not None else None
        ttc = st.gt_ttc_s if st.gt_ttc_s is not None and st.gt_ttc_s < 60 else None
        self.ccs_max = max(self.ccs_max, getattr(st, "_ccs", 0.0) or 0.0)
        self.collided = self.collided or st.collision
        if st.gt_in_path and st.gt_gap is not None:
            self.min_gap = st.gt_gap if self.min_gap is None else min(self.min_gap, st.gt_gap)
        if ttc is not None:
            self.min_ttc = ttc if self.min_ttc is None else min(self.min_ttc, ttc)
        if st.t_s > 0.25:
            self.max_decel = max(self.max_decel, -st.ego_a)
        m = {"t": st.t_s, "ego_v": st.ego_v, "gap_lidar": st.lidar_gap, "gap_gt": st.gt_gap if st.gt_in_path else None,
             "ttc": ttc, "ccs_max": self.ccs_max, "brake": st.ego_brake, "collision": self.collided,
             "guarded": getattr(world, "guarded", [])}
        self.history.append({"t": st.t_s, "gap_lidar": st.lidar_gap, "gap_gt": m["gap_gt"], "ego_v": st.ego_v,
                             "brake": st.ego_brake})
        return {"chase": chase, "drone": drone, "points": points, "gt": gt, "tracks": tracks, "lanes": lanes,
                "drone_labels": labels, "decision": d, "plan": getattr(world, "plan_entry", None), "metrics": m,
                "history": self.history, "horizon": world.s.horizon_s}

    def _write(self, buf, wall):
        self.ff.stdin.write(buf.tobytes())
        self.wall.append(round(wall, 3))

    def on_tick(self, world, st) -> None:
        now = time.time()
        try:  # LiDAR-only per-tick CCS for the running max (same formula as the episode's trajectory rows)
            from faultline.episode import _lidar_metrics
            st._ccs = _lidar_metrics({"lidar_gap": st.lidar_gap, "lidar_closing": st.lidar_closing,
                                      "ego_v": st.ego_v})["ccs"]
        except Exception:  # noqa: BLE001 - display only
            st._ccs = None
        fs = self.gather(world, st)
        self.drone.set_transform(self._drone_tf())  # for the next tick's image
        buf = render(fs)
        pe = getattr(world, "plan_entry", None)
        if self.last_buf is None and pe:
            t1 = pe.get("wall_end_epoch") or now
            lat = (pe.get("latency_ms") or 0) / 1000
            for i in range(PLAN_FRAMES):  # the desktop of the planner call's moment shows next to the card
                self._write(plan_card(buf, pe, i / PLAN_FRAMES), t1 - lat + lat * i / PLAN_FRAMES)
        d = world.last_decision
        if d is not None and d is not self.seen:
            self.seen = d
            lat = (d.get("latency_ms") or 0) / 1000
            for i in range(CARD_FRAMES):
                self._write(decision_card(self.last_buf if self.last_buf is not None else buf, d, i / CARD_FRAMES),
                            now - lat + lat * i / CARD_FRAMES)
        self._write(buf, time.time())
        self.last_buf = buf

    def close(self) -> None:
        if self.ff is None:
            return
        try:
            if self.last_buf is not None:
                res = {"collision": self.collided, "min true gap in path": f"{self.min_gap:.2f} m" if self.min_gap
                       is not None else "-", "min true TTC": f"{self.min_ttc:.2f} s" if self.min_ttc else "-",
                       "AV stack peak decel": f"{self.max_decel:.2f} m/s²", "CCS (LiDAR, max)": f"{self.ccs_max:.2f}",
                       "sim time": f"{self.history[-1]['t']:.2f} s" if self.history else "-"}
                res.update(result_extras(getattr(self.world, "final_metrics", None), getattr(self.world, "plan_entry", None)))
                for i in range(END_FRAMES):
                    self._write(result_card(self.last_buf, res, i / END_FRAMES), self.wall[-1] if self.wall else 0)
            self.ff.stdin.close()
            self.ff.wait(timeout=120)
        finally:
            self.ff = None
            (self.out_dir / "director_frames.json").write_text(json.dumps({"fps": FPS, "wall": self.wall}) + "\n")


# ---- decisions page ------------------------------------------------------------------------------------------------
def decisions_html(out_dir: Path) -> Path:
    """Self-contained page: the plan, then every checkpoint's observation summary, the forecast the model was given,
    its raw JSON and why, per-car actions, latency, request id."""
    out_dir = Path(out_dir)
    e = html.escape
    man = json.loads((out_dir / "manifest.json").read_text())
    met = json.loads((out_dir / "metrics.json").read_text())
    pe = json.loads((out_dir / "plan.json").read_text()) if (out_dir / "plan.json").exists() else None
    rows = [json.loads(x) for x in (out_dir / "decisions.jsonl").read_text().splitlines()]
    css = ("body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:1200px;padding:0 16px;background:#0f1117;"
           "color:#e6e6e6}h1,h2{font-weight:600}pre{background:#1a1d27;padding:10px;border-radius:6px;overflow-x:auto;"
           "white-space:pre-wrap}table{border-collapse:collapse;margin:6px 0}td,th{border:1px solid #333;padding:3px 8px;"
           "text-align:left}th{background:#20232e}.cp{border:1px solid #2c3040;border-radius:8px;padding:12px 16px;"
           "margin:16px 0}.halt{border-color:#c33}.k{color:#9aa}.sw{display:inline-block;width:12px;height:12px;"
           "border-radius:2px;margin-right:4px;vertical-align:middle}code{color:#ffd88a}")
    sw = lambda c: f'<span class="sw" style="background:rgb{COLORS.get(c, (150, 150, 150))}"></span>'
    out = [f"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,"
           f"initial-scale=1'><title>Swarm decisions</title><style>{css}</style></head><body>",
           f"<h1>{e(out_dir.name)}: every 0G output, verbatim</h1>",
           f"<p class='k'>{e(man.get('world', ''))} · ego {e(man.get('ego', ''))} · model {e(man.get('model', ''))} "
           f"(private tier) · {man.get('decisions_0g')} 0G decisions, {man.get('decisions_halt')} halts · status "
           f"{e(man.get('status', ''))} · collision {man.get('collision')} · guard ticks {man.get('guard_ticks')} · "
           f"<b>not anchored</b></p>",
           "<p>Ground truth: " + e(", ".join(f"{k} {v:.3g}" if isinstance(v, float) else f"{k} {v}"
                                            for k, v in met["ground_truth"].items())) + "</p>"]
    if pe:
        out.append("<h2>Plan (thinking-mode planner, one call before the episode)</h2>")
        out.append(f"<p class='k'>request {e(pe.get('request_id') or '-')} · provider {e(pe.get('provider') or '-')} · "
                   f"{pe.get('latency_ms')} ms · reasoning chars {pe.get('reasoning_chars')} · content sha256 "
                   f"<code>{e(pe.get('content_sha256') or '-')}</code> · parse {e(pe.get('plan_reason') or '')}</p>")
        out.append(f"<pre>{e(pe.get('content') or '(no content)')}</pre>")
    for d in rows:
        obs = d["observation"]
        halt = d["source"] != "0g"
        out.append(f"<div class='cp{' halt' if halt else ''}'><h2>checkpoint {d['cp']} · t = {obs['sim_time_s']} s"
                   f" · {'SAFE_HALT (' + e(d['reason']) + ')' if halt else 'phase ' + e(str(d.get('phase')))}</h2>")
        out.append(f"<p class='k'>request {e(d.get('request_id') or '-')} · provider {e(d.get('provider') or '-')} · "
                   f"Zg-Res-Key {e(short(d.get('zg_res_key'), 12))} · latency {d.get('latency_ms')} ms · raw sha256 "
                   f"<code>{e(d.get('raw_sha256') or '-')}</code></p>")
        out.append(f"<p>ego {obs['ego_speed_mps']} m/s, accel {obs['ego_accel_mps2']} m/s²</p><table><tr><th>car</th>"
                   "<th>role</th><th>position</th><th>gap m</th><th>speed</th><th>TTC</th><th>mode</th>"
                   "<th>available</th><th>chosen</th></tr>")
        acts = dict(a.split(":", 1) for a in (d.get("action") or "").split()) if not halt else {}
        for c, v in obs["cars"].items():
            out.append(f"<tr><td>{sw(c)}{c}</td><td>{e(v.get('role') or '')}</td><td>{e(v['position'])}</td>"
                       f"<td>{v['gap_m']}</td><td>{v['speed_mps']}</td><td>{v['ttc_s'] or ''}</td><td>{e(v['mode'])}</td>"
                       f"<td>{e(' '.join(v['available_actions']))}</td><td><b>{e(acts.get(c, 'SAFE_HALT'))}</b></td></tr>")
        out.append("</table>")
        fc = obs.get("forecast") or []
        if fc:
            cars = [c for c in obs["cars"] if c in fc[0]]
            out.append(f"<details><summary>forecast given to the model ({len(fc)} rows, most demanding first)</summary>"
                       "<table><tr>" + "".join(f"<th>{c}</th>" for c in cars) +
                       "<th>min gap</th><th>min TTC</th><th>nominal decel</th><th>collision</th><th>touch</th></tr>")
            for r in fc:
                hit = all(acts.get(c) == r[c] for c in cars)
                out.append(f"<tr{' style=background:#2d3a20' if hit else ''}>" + "".join(f"<td>{e(r[c])}</td>"
                           for c in cars) + f"<td>{r['min_gap_in_path_m']}</td><td>{r['min_ttc_s']}</td>"
                           f"<td>{r['nominal_ego_decel_mps2']}</td><td>{r['collision']}</td>"
                           f"<td>{r['adversaries_touch']}</td></tr>")
            out.append("</table></details>")
        out.append(f"<p>raw model output:</p><pre>{e(d.get('content') or '(none)')}</pre></div>")
    out.append("</body></html>")
    p = out_dir / "decisions.html"
    p.write_text("\n".join(out))
    return p
