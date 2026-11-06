#!/usr/bin/env python3
"""Generate viz/faultline_hmi.json, the Foxglove HMI layout (recipe reused from SeDriCa's sedrica_hmi
tools/make_*layout.py, the user's own repo), and optionally install it as a local layout in a Foxglove Studio data dir.

    python3 viz/foxglove_layout.py                       # rewrite viz/faultline_hmi.json
    python3 viz/foxglove_layout.py --install DATA_DIR    # + DATA_DIR/studio-datastores/layouts-local/<LAYOUT_ID>

One column (640x960 right of the chase camera; RViz shows the LiDAR): mode / SAFE_HALT, the decision line, three large
plots against simulation time (each /faultline/hmi/* message holds the run's sim-time history): speed (ego vs each
attacker), gap (LiDAR vs ground truth), TTC with the 1.5 s line, then the attackers' current actions.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent / "faultline_hmi.json"
LAYOUT_ID = "faultline-hmi"  # opened with foxglove://open?...&layoutId=faultline-hmi

def titled(title):  # Lichtblick reads lichtblickPanelTitle, Foxglove Studio foxglovePanelTitle
    return {"foxglovePanelTitle": title, "lichtblickPanelTitle": title}


def raw(path, title, size):
    return {"topicPath": path, "diffEnabled": False, "diffMethod": "custom", "diffTopicPath": "",
            "showFullMessageForDiff": False, "fontSize": size, "defaultExpanded": True, **titled(title)}


# director.COLORS (ego green, A red, B yellow taxi, C blue, D magenta) so the plots match the video
COLORS = {"ego": "#28dc78", "adversary": "#f5c300", "A": "#e62828", "B": "#f5c300", "C": "#2878f5", "D": "#d23cdc"}


def plot(title, xpath, *series, ymin=None, ymax=None):
    """series: (message path, label, colour), arrays from each topic's latest message, against the sim-time array
    `xpath` (Lichtblick's "Path (current)" x axis: the run's history, replaced when a new run starts)."""
    p = {**titled(title),
         "paths": [{"value": path, "label": label, "color": color, "enabled": True, "timestampMethod": "headerStamp",
                    "showLine": True, "lineSize": 2} for path, label, color in series],
         "showXAxisLabels": True, "showYAxisLabels": True, "showYAxisGridLines": True, "showLegend": True,
         "legendDisplay": "floating", "floatingLegendPosition": "top-right", "showPlotValuesInLegend": False,
         "isSynced": False, "xAxisVal": "currentCustom", "xAxisPath": {"value": xpath, "enabled": True},
         "xAxisLabel": "sim time [s]"}
    if ymin is not None:
        p["minYValue"] = ymin
    if ymax is not None:
        p["maxYValue"] = ymax
    return p


def col(first, second, pct=50.0):
    return {"first": first, "second": second, "direction": "column", "splitPercentage": pct}


def row(first, second, pct=50.0):
    return {"first": first, "second": second, "direction": "row", "splitPercentage": pct}


def layout() -> dict:
    cfg = {
        # Lichtblick 1.29's Indicator panels never received data from foxglove_bridge here (also with the topics
        # advertised before load, after a reload, on Float64/Bool); RawMessages panels show the same values reliably.
        "RawMessages!mode": raw("/faultline/mode.data", "mode (RUNUP / AWAITING_0G / EXECUTING / SAFE_HALT)", 15),
        "RawMessages!halt": raw("/faultline/safe_halt.data", "safe_halt", 15),
        "RawMessages!decision": raw("/faultline/decision.data",
                                    "adversary decision (cp · action · source · request · latency)", 13),
        "Plot!speed": plot("speed [m/s]: AV stack (ego) vs each attacker", "/faultline/hmi/speed/ego.position[:]",
                           *((f"/faultline/hmi/speed/{c}.velocity[:]", "AV stack" if c == "ego" else c, COLORS[c])
                             for c in ("ego", "adversary", "A", "B", "C", "D")), ymin=0),
        "Plot!gap": plot("gap ahead [m]: LiDAR vs ground truth", "/faultline/hmi/gap.position[:]",
                         ("/faultline/hmi/gap.velocity[:]", "LiDAR", "#3cc8ff"),
                         ("/faultline/hmi/gap.effort[:]", "ground truth", "#ff9a1f"), ymin=0),
        "Plot!ttc": plot("TTC from LiDAR [s]", "/faultline/hmi/ttc.position[:]",
                         ("/faultline/hmi/ttc.velocity[:]", "TTC", "#3cc8ff"),
                         ("/faultline/hmi/ttc.effort[:]", "1.5 s line", "#ff4040"), ymin=0, ymax=8),
        # StateTransitions stayed empty on live String topics in the same way as Indicator: a text panel instead
        "RawMessages!action": raw("/faultline/adversary_action.data", "attackers' current actions", 14),
    }
    head = col(row("RawMessages!mode", "RawMessages!halt", 65.0), "RawMessages!decision", 50.0)
    plots = col("Plot!speed", col("Plot!gap", col("Plot!ttc", "RawMessages!action", 78.0), 50.0), 34.0)
    tree = col(head, plots, 19.0)
    return {"configById": cfg, "globalVariables": {}, "userNodes": {}, "playbackConfig": {"speed": 1}, "layout": tree}


def install(data_dir: Path, data: dict) -> Path:
    """Local-layout record in the format Foxglove Studio 3.5 keeps in studio-datastores/layouts-local/<id>."""
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    p = data_dir / "studio-datastores" / "layouts-local" / LAYOUT_ID
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"id": LAYOUT_ID, "name": "Faultline HMI", "permission": "CREATOR_WRITE",
                             "baseline": {"data": data, "savedAt": now}}))
    return p


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--install", type=Path)
    a = ap.parse_args()
    data = layout()
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print(OUT)
    if a.install:
        print(install(a.install, data))
