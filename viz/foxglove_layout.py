#!/usr/bin/env python3
"""Generate viz/faultline_hmi.json, the Foxglove HMI layout (recipe reused from SeDriCa's sedrica_hmi
tools/make_*layout.py, the user's own repo), and optionally install it as a local layout in a Foxglove Studio data dir.

    python3 viz/foxglove_layout.py                       # rewrite viz/faultline_hmi.json
    python3 viz/foxglove_layout.py --install DATA_DIR    # + DATA_DIR/studio-datastores/layouts-local/<LAYOUT_ID>

One tall column (it sits right of the chase camera): mode / SAFE_HALT, the decision line, a 3D view
following the ego, then speed, gap, TTC, steer/accel plots and the adversary action.
"""
import argparse
import copy
import json
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent / "faultline_hmi.json"
LAYOUT_ID = "faultline-hmi"  # opened with foxglove://open?...&layoutId=faultline-hmi

GRID = {"grid": {"visible": True, "frameLocked": True, "label": "Grid (10 m)", "instanceId": "grid",
                 "layerId": "foxglove.Grid", "size": 200, "divisions": 20, "lineWidth": 1, "color": "#ffffff20",
                 "position": [0, 0, 0], "rotation": [0, 0, 0], "order": 1}}


def raw(path, title, size):
    return {"topicPath": path, "diffEnabled": False, "diffMethod": "custom", "diffTopicPath": "",
            "showFullMessageForDiff": False, "fontSize": size, "defaultExpanded": True, "foxglovePanelTitle": title}


def plot(title, *series, window=30):
    return {"foxglovePanelTitle": title,
            "paths": [{"value": f"{topic}.data", "label": label, "enabled": True, "timestampMethod": "receiveTime",
                       "showLine": True} for topic, label in series],
            "showXAxisLabels": True, "showYAxisLabels": True, "showYAxisGridLines": True, "showLegend": True,
            "legendDisplay": "floating", "floatingLegendPosition": "top-left", "showPlotValuesInLegend": True,
            "isSynced": False, "xAxisVal": "timestamp", "timeWindowMode": "sliding", "followingViewWidth": window}


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
        "3D!scene": {
            "cameraState": {"distance": 45, "perspective": True, "phi": 50, "thetaOffset": 90, "target": [0, 0, 0],
                            "targetOffset": [10, 0, 0], "targetOrientation": [0, 0, 0, 1], "fovy": 45, "near": 0.5,
                            "far": 5000},
            "followMode": "follow-pose", "followTf": "ego",
            "scene": {"enableStats": False, "backgroundColor": "#161a20",
                      "transforms": {"showLabel": False, "lineColor": "#ffffff00", "lineWidth": 0.0}},
            "transforms": {},
            "topics": {"/faultline/lidar": {"visible": True, "pointSize": 2, "pointShape": "circle",
                                            "colorMode": "colormap", "colorMap": "turbo", "colorField": "z",
                                            "decayTime": 0},
                       "/faultline/lanelet_map": {"visible": True}, "/faultline/gt": {"visible": True},
                       "/faultline/tracks": {"visible": True}},
            "layers": copy.deepcopy(GRID), "imageMode": {},
            "foxglovePanelTitle": "3D: LiDAR (turbo by z), lanelet map, GT boxes (green ego / orange adversary), tracks (cyan)"},
        "Plot!speed": plot("speed [m/s]: ego vs adversary", ("/faultline/ego/speed", "ego"),
                           ("/faultline/adversary/speed", "adversary")),
        "Plot!gap": plot("gap [m]: LiDAR vs ground truth", ("/faultline/gap_lidar", "LiDAR"),
                         ("/faultline/gap_gt", "GT")),
        "Plot!ttc": plot("TTC from LiDAR [s]", ("/faultline/ttc", "TTC")),
        "Plot!ctl": plot("ego accel [m/s2] and steer [-1..1]", ("/faultline/ego/accel", "accel"),
                         ("/faultline/ego/steer", "steer")),
        # StateTransitions stayed empty on live String topics in the same way as Indicator: a text panel instead
        "RawMessages!action": raw("/faultline/adversary_action.data", "adversary action", 14),
    }
    head = col(row("RawMessages!mode", "RawMessages!halt", 65.0), "RawMessages!decision", 50.0)
    plots = col(col("Plot!speed", "Plot!gap"), col("Plot!ttc", col("Plot!ctl", "RawMessages!action", 60.0), 33.0))
    tree = col(head, col("3D!scene", plots, 42.0), 22.0)
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
