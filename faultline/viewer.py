"""Optional live view of a CARLA run: chase camera in a Tk window (e.g. on a VNC display) with a HUD, plus an ffmpeg
screen recording of that window. Display only: it reads the world and decisions.jsonl, never feeds anything back."""
import json
import queue
import subprocess
import tkinter as tk
from pathlib import Path

import carla
import numpy as np

from faultline.policy import ACTION_DECEL, SAFE_HALT_DECEL

W, H, HUD_H = 1280, 720, 64
NAMES = {v: k for k, v in ACTION_DECEL.items() if v}


class ChaseView:
    def __init__(self, out_dir: Path, record: bool = True):
        self.out_dir, self.record = Path(out_dir), record
        self.cam, self.ff, self.root, self.n_lines, self.last = None, None, None, 0, "waiting for first checkpoint"

    def attach(self, world) -> None:
        """Call after world.reset(); hooks world.on_tick."""
        bp = world.world.get_blueprint_library().find("sensor.camera.rgb")
        for k, v in {"image_size_x": str(W), "image_size_y": str(H), "fov": "90"}.items():
            bp.set_attribute(k, v)
        self.cam = world.world.spawn_actor(bp, carla.Transform(carla.Location(x=-7.0, z=3.0), carla.Rotation(pitch=-10)),
                                           attach_to=world.ego)
        world.actors.append(self.cam)
        self.frames = queue.Queue()
        self.cam.listen(self.frames.put)
        self.root = tk.Tk()
        self.root.title(f"Faultline · {self.out_dir.name}")
        self.root.geometry(f"{W}x{H + HUD_H}+0+0")
        self.root.overrideredirect(True)  # no window manager needed; stays above a crashed/locked desktop
        self.cv = tk.Canvas(self.root, width=W, height=H + HUD_H, bg="black", highlightthickness=0)
        self.cv.pack()
        self.img_item = self.cv.create_image(0, 0, anchor="nw")
        self.hud1 = self.cv.create_text(12, H + 8, anchor="nw", fill="white", font=("DejaVu Sans Mono", 14))
        self.hud2 = self.cv.create_text(12, H + 34, anchor="nw", fill="#9fe39f", font=("DejaVu Sans Mono", 13))
        self.root.update()
        if self.record:
            x, y = self.root.winfo_rootx(), self.root.winfo_rooty()
            self.ff = subprocess.Popen(
                ["ffmpeg", "-loglevel", "error", "-y", "-f", "x11grab", "-framerate", "20", "-video_size",
                 f"{W}x{H + HUD_H}", "-i", f"{self.root.winfo_screen() or ':2'}+{x},{y}", "-c:v", "libx264",
                 "-preset", "veryfast", "-pix_fmt", "yuv420p", str(self.out_dir / "screen.mp4")],
                stdin=subprocess.PIPE)
        world.on_tick = self.on_tick

    def _decision_line(self) -> None:
        p = self.out_dir / "decisions.jsonl"
        lines = p.read_text().splitlines() if p.exists() else []
        if len(lines) > self.n_lines:
            self.n_lines = len(lines)
            d = json.loads(lines[-1])
            rid = (d.get("request_id") or "-")[:18]
            self.last = (f"cp {d['cp']:>2}  {d['action'] or 'SAFE_HALT':<10} source {d['source']:<17} reason "
                         f"{d['reason']:<12} req {rid}  {d['latency_ms']} ms")

    def on_tick(self, world, st) -> None:
        img = self.frames.get(timeout=10.0)
        while img.frame < world.world.get_snapshot().frame:
            img = self.frames.get(timeout=10.0)
        bgra = np.frombuffer(img.raw_data, dtype=np.uint8).reshape(H, W, 4)
        ppm = f"P6 {W} {H} 255 ".encode() + bgra[:, :, 2::-1].tobytes()
        self.photo = tk.PhotoImage(data=ppm, format="PPM")
        self.cv.itemconfig(self.img_item, image=self.photo)
        ctl = getattr(world, "control_label", None)  # cut-in world: the adversary's current action
        if ctl is None:
            dec = world.kin.lead.decel
            ctl = "MAINTAIN" if not dec else ("SAFE_HALT" if dec == SAFE_HALT_DECEL else NAMES.get(dec, "BRAKE_HARD"))
        gap = "  --  " if st.lidar_gap is None else f"{st.lidar_gap:6.2f}"
        ttc = f"{st.lidar_gap / st.lidar_closing:5.2f}" if st.lidar_gap and st.lidar_closing and st.lidar_closing > 0.05 else "  -- "
        self._decision_line()
        self.cv.itemconfig(self.hud1, text=f"t {st.t_s:5.2f} s   LiDAR gap {gap} m   TTC {ttc} s   ego {st.ego_v:5.2f} m/s"
                                            f"   adversary {st.lead_v:5.2f} m/s   control {ctl}"
                                            + ("   COLLISION" if st.collision else ""))
        self.cv.itemconfig(self.hud2, text="decision " + self.last)
        self.root.lift()
        self.root.update()

    def close(self) -> None:
        if self.ff:
            self.ff.communicate(b"q")
            self.ff = None
        if self.root:
            self.root.destroy()
            self.root = None
