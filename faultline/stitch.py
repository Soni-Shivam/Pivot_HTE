"""Record the :2 desktop during a run and stitch RViz + the Lichtblick HMI next to director.mp4 (display only).

The desktop recording keeps x11grab's wall-clock timestamps (-copyts), and director_frames.json holds the wall-clock
time of every director frame, so each stitched frame shows the RViz/HMI frame captured at that same moment. Frames
grabbed while the sim was paused for a 0G call are only used under the matching "0G deciding" card; the rest of the
pause is dropped (what mpdecimate would approximate, but exact). Layout 1920x1008: director 1280x720 top-left, RViz
(render area) 1280x288 under it, HMI 640x842 on the right, a caption box bottom-right.

    python -m faultline.stitch runs/<id>          # needs runs/<id>/{director.mp4,director_frames.json,desk.mkv,windows.json}
"""
import bisect
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

OUT_W, OUT_H = 1920, 1008
SLOTS = {"director": (0, 0, 1280, 720), "rviz": (0, 720, 1280, 288), "hmi": (1280, 0, 640, 842),
         "caption": (1280, 842, 640, 166)}
SKIP_TOP = {"rviz": 49}  # RViz menu + toolbar
SCREEN = (1920, 1150)  # the xfce dock covers y >= 1151 of the 1920x1200 :2 desktop
TITLES = {"rviz": " - RViz", "hmi": "Lichtblick"}
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
    """{slot: [x, y, w, h]} (absolute) from `xwininfo -root -tree`, the largest window whose title matches."""
    out = {}
    for ln in tree.splitlines():
        m = GEOM.match(ln)
        if not m:
            continue
        t, w, h, x, y = m[1], int(m[2]), int(m[3]), int(m[4]), int(m[5])
        for k, sub in titles.items():
            if sub.lower() in t.lower() and w * h > 100 * 100 and w * h > (out.get(k, [0, 0, 0, 0])[2] *
                                                                          out.get(k, [0, 0, 0, 0])[3]):
                out[k] = [x, y, w, h]
    return out


def find_windows(display=":2") -> dict:
    import os
    tree = subprocess.run(["xwininfo", "-root", "-tree"], capture_output=True, text=True,
                          env={**os.environ, "DISPLAY": display}).stdout
    return parse_windows(tree)


def _even(n):
    return max(2, n - n % 2)


def crop_cmd(src, rect, w, h, screen=SCREEN, skip_top=0) -> list:
    """Decode the desktop recording, crop one window (minus `skip_top` px, clamped to the visible screen), scale into
    its slot, raw BGR out."""
    x, y, cw, ch = rect[0], rect[1] + skip_top, rect[2], rect[3] - skip_top
    x, y = max(0, x), max(0, y)
    cw, ch = _even(min(cw, screen[0] - x)), _even(min(ch, screen[1] - y))
    return ["ffmpeg", "-loglevel", "error", "-copyts", "-i", str(src), "-fps_mode", "passthrough", "-vf",
            f"crop={cw}:{ch}:{x}:{y},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]


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


def caption(run: Path) -> np.ndarray:
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
    p.text(16, 14, f"Faultline · {run.name}", 22, bold=True)
    p.lines(16, 50, [f"plan: {plan}" if plan else "", "director (sim time) · RViz below · Lichtblick HMI above",
                     "desktop crops matched to sim time by wall clock;", "0G pauses dropped · not anchored"], 15,
            (200, 200, 200))
    p.flush()
    return buf[:, :, :3].copy()


def stitch(run) -> Path:
    run = Path(run)
    wall = json.loads((run / "director_frames.json").read_text())["wall"]
    rects = json.loads((run / "windows.json").read_text())
    times = frame_times(run / "desk.mkv")
    streams = {"director": _Stream(decode_cmd(run / "director.mp4", 1280, 720), 1280, 720)}
    for k in ("rviz", "hmi"):
        if k in rects:
            _, _, w, h = SLOTS[k]
            streams[k] = _Stream(crop_cmd(run / "desk.mkv", rects[k], w, h, skip_top=SKIP_TOP.get(k, 0)), w, h)
    enc = subprocess.Popen(encode_cmd(run / "stitched.mp4"), stdin=subprocess.PIPE)
    canvas = np.zeros((OUT_H, OUT_W, 3), np.uint8)
    x, y, w, h = SLOTS["caption"]
    canvas[y:y + h, x:x + w] = caption(run)
    try:
        last = 0
        for i, t in enumerate(wall):
            j = max(desk_index(times, t), last)  # monotonic: a card mapped to an earlier moment holds the frame
            last = j
            for k, s in streams.items():
                x, y, w, h = SLOTS[k]
                canvas[y:y + h, x:x + w] = s.at(i if k == "director" else j)
            enc.stdin.write(canvas.tobytes())
    finally:
        for s in streams.values():
            s.close()
        enc.stdin.close()
        enc.wait()
    return run / "stitched.mp4"


if __name__ == "__main__":
    print(stitch(sys.argv[1]))
