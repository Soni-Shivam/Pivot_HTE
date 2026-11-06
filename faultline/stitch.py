"""Record the :2 desktop during a run and stitch RViz + the Lichtblick HMI next to director.mp4 (display only).

The desktop recording keeps x11grab's wall-clock timestamps (-copyts), and director_frames.json holds the wall-clock
time of every director frame, so each stitched frame shows the RViz/HMI frame captured at that same moment. Frames
grabbed while the sim was paused for a 0G call are only used under the matching "0G deciding" card; the rest of the
pause is dropped (what mpdecimate would approximate, but exact). Layout 1920x1080: director 1280x720 top-left, the RViz
render area under it (1280x360), the Lichtblick page content in the right column (640x960), a caption box below it.
Every crop is letterboxed into its slot (aspect kept, never stretched). Without director.mp4 (a scripted demo_live run)
the ChaseView window on the desktop fills the director slot, timed by chase_frames.json (wall time of each tick).

    python -m faultline.stitch runs/<id>   # runs/<id>/{desk.mkv,windows.json} + director.{mp4,_frames.json} | chase_frames.json
"""
import bisect
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

OUT_W, OUT_H = 1920, 1080
SLOTS = {"director": (0, 0, 1280, 720), "rviz": (0, 720, 1280, 360), "hmi": (1280, 0, 640, 960),
         "caption": (1280, 960, 640, 120)}
SCREEN = (1920, 1150)  # the xfce dock covers y >= 1151 of the 1920x1200 :2 desktop
TITLES = {"rviz": " - RViz", "hmi": "Lichtblick", "chase": "Faultline \u00b7 "}
LAYOUT = 2  # windows.json written by find_windows from viz/launch_viz.sh's v2 placement
# (left, top, right, bottom) px cut from a window rect to keep only its content. v2: Firefox with the system title
# bar and no toolbox (viz/launch_viz.sh userChrome.css), minus Lichtblick's app bar; RViz uses its render child window.
INSETS = {"hmi": (0, 40, 0, 0), "rviz": (16, 62, 16, 30)}
# recordings before v2 (no "layout" key): measured on runs/swarm-carla-010/desk.mkv (CSD shadow 26 px, tab + url bar +
# Lichtblick app bar 124 px; RViz render child at +16+62 of its window, as in xwininfo)
LEGACY_INSETS = {"hmi": (26, 124, 26, 27), "rviz": (16, 62, 16, 30)}
GEOM = re.compile(r'^\s*0x[0-9a-f]+ "(.*)": .*?\s(\d+)x(\d+)\+-?\d+\+-?\d+\s+\+(-?\d+)\+(-?\d+)\s*$')


def desk_cmd(path, display=":2", size="1920x1200", fps=20) -> list:
    return ["ffmpeg", "-loglevel", "error", "-y", "-f", "x11grab", "-framerate", str(fps), "-video_size", size,
            "-i", display, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", "-copyts", "-fps_mode",
            "passthrough", str(path)]


class DeskRecorder:
    def __init__(self, path, display=":2"):
        self.path, self.display, self.p = Path(path), display, None

    def start(self):
        self.p = subprocess.Popen(desk_cmd(self.path, self.display), stdin=subprocess.PIPE)
        return self

    def stop(self):
        if self.p:
            try:
                self.p.communicate(b"q", timeout=60)
            except subprocess.TimeoutExpired:
                self.p.kill()
            self.p = None


def parse_windows(tree: str, titles=TITLES) -> dict:
    """{slot: [x, y, w, h]} (absolute) from `xwininfo -root -tree`, the largest window whose title matches; also
    "rviz_view", RViz's render widget (a child window titled exactly "rviz2")."""
    out = {}
    for ln in tree.splitlines():
        m = GEOM.match(ln)
        if not m:
            continue
        t, w, h, x, y = m[1], int(m[2]), int(m[3]), int(m[4]), int(m[5])
        if t == "rviz2" and w * h > 100 * 100 and w * h > (out.get("rviz_view", [0, 0, 0, 0])[2] *
                                                         out.get("rviz_view", [0, 0, 0, 0])[3]):
            out["rviz_view"] = [x, y, w, h]
        for k, sub in titles.items():
            if sub.lower() in t.lower() and w * h > 100 * 100 and w * h > (out.get(k, [0, 0, 0, 0])[2] *
                                                                          out.get(k, [0, 0, 0, 0])[3]):
                out[k] = [x, y, w, h]
    return out


def find_windows(display=":2") -> dict:
    import os
    tree = subprocess.run(["xwininfo", "-root", "-tree"], capture_output=True, text=True,
                          env={**os.environ, "DISPLAY": display}).stdout
    return {**parse_windows(tree), "layout": LAYOUT}


def _even(n):
    return max(2, n - n % 2)


def content_rect(rects: dict, k: str) -> list | None:
    """The content area of slot `k` on the desktop: RViz's render child if recorded, else the window minus insets."""
    if k == "rviz" and "rviz_view" in rects:
        return rects["rviz_view"]
    if k not in rects:
        return None
    left, top, right, bottom = (INSETS if rects.get("layout") == LAYOUT else LEGACY_INSETS)[k]
    x, y, w, h = rects[k]
    return [x + left, y + top, w - left - right, h - top - bottom]


def crop_cmd(src, rect, w, h, screen=SCREEN) -> list:
    """Decode the desktop recording, crop one content rect (clamped to the visible screen), letterbox it into a w x h
    slot (aspect kept, never stretched), raw BGR out."""
    x, y, cw, ch = max(0, rect[0]), max(0, rect[1]), rect[2], rect[3]
    cw, ch = _even(min(cw, screen[0] - x)), _even(min(ch, screen[1] - y))
    return ["ffmpeg", "-loglevel", "error", "-copyts", "-i", str(src), "-fps_mode", "passthrough", "-vf",
            f"crop={cw}:{ch}:{x}:{y},scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x10121a", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]


def decode_cmd(src, w, h) -> list:
    return ["ffmpeg", "-loglevel", "error", "-i", str(src), "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt",
            "bgr24", "-"]


def encode_cmd(dst, w=OUT_W, h=OUT_H, fps=20) -> list:
    return ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r",
            str(fps), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", str(dst)]


def frame_times(src) -> list:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of",
                        "csv=p=0", str(src)], capture_output=True, text=True, check=True)
    return sorted(float(x.strip(",")) for x in r.stdout.split() if x.strip(","))


def desk_index(times: list, wall: float) -> int:
    """Index of the last desktop frame grabbed at or before `wall` (0 before the recording started)."""
    return max(bisect.bisect_right(times, wall) - 1, 0)


class _Stream:
    """Sequential raw frames from an ffmpeg pipe; `at(i)` returns frame i (never goes back; holds the last)."""

    def __init__(self, cmd, w, h):
        self.p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
        self.n, self.size, self.shape, self.i, self.cur = 0, w * h * 3, (h, w, 3), -1, np.zeros((h, w, 3), np.uint8)

    def at(self, i):
        while self.i < i:
            b = self.p.stdout.read(self.size)
            if len(b) < self.size:
                break
            self.cur, self.i = np.frombuffer(b, np.uint8).reshape(self.shape), self.i + 1
        return self.cur

    def close(self):
        self.p.stdout.close()
        self.p.kill()
        self.p.wait()


def caption(run: Path, scripted: bool = False) -> np.ndarray:
    from faultline.director import Painter
    x, y, w, h = SLOTS["caption"]
    buf = np.zeros((h, w, 4), np.uint8)
    buf[:, :, :3] = (24, 18, 16)
    p = Painter(buf)
    plan = ""
    try:
        plan = (json.loads((run / "plan.json").read_text()).get("plan") or {}).get("name", "")
    except (OSError, ValueError):
        pass
    p.text(16, 10, f"Faultline · {run.name}", 20, bold=True)
    p.lines(16, 38, [f"plan: {plan}" if plan else ("SCRIPTED demo: no 0G decision" if scripted else ""),
                     "director (sim time) · RViz LiDAR below · HMI above",
                     "desktop crops matched by wall clock · 0G pauses dropped · not anchored"], 13, (200, 200, 200))
    p.text(16, 98, "AV stack under test: pdm-lite (demo)", 11, (150, 150, 150))
    p.flush()
    return buf[:, :, :3].copy()


def stitch(run) -> Path:
    run = Path(run)
    rects = json.loads((run / "windows.json").read_text())
    times = frame_times(run / "desk.mkv")
    scripted = not (run / "director.mp4").exists()
    streams = {}
    if scripted:  # demo_live: the desktop's ChaseView window is the director, at each tick's wall time
        wall = json.loads((run / "chase_frames.json").read_text())["wall"]
    else:
        wall = json.loads((run / "director_frames.json").read_text())["wall"]
        streams["director"] = _Stream(decode_cmd(run / "director.mp4", 1280, 720), 1280, 720)
    for k in ("director", "rviz", "hmi"):
        r = None if k in streams else (rects["chase"] if k == "director" else content_rect(rects, k))
        if r:
            _, _, w, h = SLOTS[k]
            streams[k] = _Stream(crop_cmd(run / "desk.mkv", r, w, h), w, h)
    enc = subprocess.Popen(encode_cmd(run / "stitched.mp4"), stdin=subprocess.PIPE)
    canvas = np.zeros((OUT_H, OUT_W, 3), np.uint8)
    canvas[:] = (26, 18, 16)
    x, y, w, h = SLOTS["caption"]
    canvas[y:y + h, x:x + w] = caption(run, scripted)
    try:
        last = 0
        for i, t in enumerate(wall):
            j = max(desk_index(times, t), last)  # monotonic: a card mapped to an earlier moment holds the frame
            last = j
            for k, s in streams.items():
                x, y, w, h = SLOTS[k]
                canvas[y:y + h, x:x + w] = s.at(i if k == "director" and not scripted else j)
            enc.stdin.write(canvas.tobytes())
    finally:
        for s in streams.values():
            s.close()
        enc.stdin.close()
        enc.wait()
    return run / "stitched.mp4"


if __name__ == "__main__":
    print(stitch(sys.argv[1]))
