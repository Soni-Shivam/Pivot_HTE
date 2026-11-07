"""Capture a real LiDAR point cloud of CARLA Town10 for the studio hero background.

Drives the ego along a Town10 route with the 64-channel LiDAR of CarlaWorld (takes the shared flock, never loads or
restarts CARLA, restores async mode and destroys its actors in close()), accumulates scans in the world frame,
voxel-downsamples, and writes Float32 xyz + Uint8 height colour index.
Usage: .venv/bin/python scripts/capture_lidar_map.py apps/faultline-studio/public/town10-lidar.bin [seed] [seconds]
"""
import struct
import sys

import numpy as np

from faultline.carla_world import CarlaWorld
from faultline.config import Scenario

out, seed, secs = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 3, float(sys.argv[3]) if len(sys.argv) > 3 else 14.0
s = Scenario(seed=seed, initial_gap_m=60.0, lead_max_brake_mps2=0.0)
w = CarlaWorld(map_name="Town10HD")  # substring of the loaded map name: never triggers a reload when Town10HD_Opt is up
clouds = []
try:
    w.reset(s)
    for i in range(int(secs / s.dt_s)):
        w.tick()
        if i % 2 == 0 and w.last_scan is not None:
            raw = np.frombuffer(w.last_scan.raw_data, dtype=np.float32).reshape(-1, 4)[:, :3]
            m = np.array(w.last_scan.transform.get_matrix())
            pts = np.c_[raw, np.ones(len(raw))] @ m.T
            clouds.append(pts[:, :3].astype(np.float32))
finally:
    w.close()
p = np.concatenate(clouds)
p[:, 1] *= -1  # CARLA is left-handed (y right); flip to a right-handed frame for display
v = np.floor(p / 0.6).astype(np.int64)
_, idx = np.unique(v, axis=0, return_index=True)
p = p[idx]
if len(p) > 55000:
    p = p[np.random.default_rng(0).choice(len(p), 55000, replace=False)]
p -= p.mean(axis=0)
z = p[:, 2]
lo, hi = np.percentile(z, 2), np.percentile(z, 98)
c = np.clip((z - lo) / max(hi - lo, 1e-6) * 255, 0, 255).astype(np.uint8)
with open(out, "wb") as f:
    f.write(struct.pack("<I", len(p)))
    f.write(p.astype("<f4").tobytes())
    f.write(c.tobytes())
print(f"{len(p)} points from {len(clouds)} scans -> {out}")
