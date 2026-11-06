"""Copy every run video (not the raw desktop segments) into videos/ as a GitHub-sized H.264 file, write videos/README.md,
and with --commit commit only videos/. Safe to re-run: existing outputs are skipped.
    python3 scripts/publish_videos.py [--commit]"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "runs" / "videos", ROOT / "videos"
MAX_MB = 45  # GitHub warns at 50 MB and refuses files over 100 MB


def encode(src: Path, dst: Path) -> None:
    tmp = dst.with_suffix(".part.mp4")
    for crf in (30, 34, 38):  # step down quality only if a long clip is still too big
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-an", "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", str(crf), "-vf", "scale='min(1920,iw)':-2", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                        str(tmp)], check=True)
        if tmp.stat().st_size < MAX_MB * 1e6:
            break
    tmp.replace(dst)


def main() -> None:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "video_index.py")], check=True, capture_output=True)
    OUT.mkdir(exist_ok=True)
    rows = [l for l in (SRC / "INDEX.md").read_text().splitlines() if l.startswith("| [") and "desktop__" not in l]
    new = 0
    for row in rows:
        name = row.split("](")[0][3:]
        dst = OUT / name
        if not dst.exists() and (SRC / name).exists():
            encode((SRC / name).resolve(), dst)
            new += 1
    lines = ["# Faultline videos", "", "Recorded Faultline runs (CARLA 0.10 + 0G), re-encoded for GitHub. Newest first. "
             "Full-quality originals and evidence: `runs/<run>/` on the build machine; each run's evidence doc is in "
             "`docs/evidence/`.", "", "| video | length | recorded | what |", "|---|---|---|---|"]
    lines += [r for r in rows if (OUT / r.split("](")[0][3:]).exists()]
    (OUT / "README.md").write_text("\n".join(lines) + "\n")
    print(f"{new} new, {len(lines) - 6} videos in videos/")
    if "--commit" in sys.argv:
        subprocess.run(["git", "add", "videos"], cwd=ROOT, check=True)
        if subprocess.run(["git", "diff", "--cached", "--quiet", "--", "videos"], cwd=ROOT).returncode:
            subprocess.run(["git", "commit", "-q", "-m", f"videos: {new} new run video(s) for GitHub", "--", "videos"],
                           cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
