"""Collect every Faultline video into runs/videos/ (symlinks, readable names) and write runs/videos/INDEX.md.
Re-run any time: python3 scripts/video_index.py"""
import json
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "runs" / "videos"


def duration(p: Path) -> float | None:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None  # still being written


def describe(run: Path) -> str:
    try:
        m = json.loads((run / "manifest.json").read_text())
        met = json.loads((run / "metrics.json").read_text())
    except (OSError, ValueError):
        return ""
    if run.name.endswith("-replay") or "replay" in run.name:
        return f"REPLAY of recorded decisions (no new 0G calls) · {m.get('status')} · collision {m.get('collision')}"
    src = "0G" if m.get("decisions_0g") else ("scripted" if m.get("status") == "completed" else "halt")
    return (f"{m.get('family', 'lead_brake')} · {m.get('status')} · {m.get('decisions_0g', 0)} 0G decisions "
            f"({src}) · collision {m.get('collision')} · " + (f"CCS {met['ground_truth']['ccs']:.2f} (ground truth)"
            if isinstance(met.get("ground_truth"), dict) else f"CCS {met.get('ccs', 0):.2f}"))


rows = []
for p in sorted((ROOT / "runs").glob("*/screen.mp4")):
    rows.append((p, f"{p.parent.name}__chase.mp4", describe(p.parent)))
for p in sorted((ROOT / "runs" / "screenrec").glob("desk-*.mp4")):
    rows.append((p, f"desktop__{p.stem[5:]}.mp4", "full :2 desktop recording (5-min segment)"))
for p in sorted((ROOT / "docs" / "evidence" / "media").glob("*.mp4")):
    rows.append((p, f"evidence__{p.name}", "evidence clip (committed)"))

OUT.mkdir(parents=True, exist_ok=True)
lines = ["# Faultline videos", "", f"Updated {datetime.now():%Y-%m-%d %H:%M}. Newest first. Files are symlinks to the originals.", "",
         "| video | length | recorded | what |", "|---|---|---|---|"]
for src, name, what in sorted(rows, key=lambda r: r[0].stat().st_mtime, reverse=True):
    d = duration(src)
    if d is None:
        continue
    link = OUT / name
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(src)
    lines.append(f"| [{name}]({name}) | {d:.0f} s | {datetime.fromtimestamp(src.stat().st_mtime):%m-%d %H:%M} | {what} |")
(OUT / "INDEX.md").write_text("\n".join(lines) + "\n")
print(f"{len(lines) - 6} videos indexed -> {OUT / 'INDEX.md'}")
