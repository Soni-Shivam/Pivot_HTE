#!/usr/bin/env python3
"""Move/resize or close X11 windows by title (no xdotool/wmctrl on this machine): titles from `xwininfo -tree`,
actions through libX11 via ctypes.

    DISPLAY=:2 python3 viz/xplace.py "faultline.rviz - RViz" 1280x416+0+784 [--wait 20]
    DISPLAY=:2 python3 viz/xplace.py "Lichtblick" --close     # XKillClient (snap Firefox ignores our signals)

Acts on every window whose title contains the text (case-insensitive); exits 1 if none appeared in time.
"""
import ctypes
import ctypes.util
import re
import subprocess
import sys
import time

X = ctypes.cdll.LoadLibrary(ctypes.util.find_library("X11"))
X.XOpenDisplay.restype = ctypes.c_void_p
X.XOpenDisplay.argtypes = [ctypes.c_char_p]
X.XMoveResizeWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint,
                                ctypes.c_uint]
X.XKillClient.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
X.XFlush.argtypes = [ctypes.c_void_p]
LINE = re.compile(r'^\s*(0x[0-9a-f]+) "(.*)": \(')


def find(title):
    out = subprocess.run(["xwininfo", "-root", "-tree"], capture_output=True, text=True).stdout
    return [int(m[1], 16) for m in map(LINE.match, out.splitlines()) if m and title.lower() in m[2].lower()]


def act(title, geom, wait_s=0.0):
    deadline = time.monotonic() + wait_s
    while not (hits := find(title)) and time.monotonic() < deadline:
        time.sleep(0.5)
    d = X.XOpenDisplay(None)
    if not d:
        sys.exit("cannot open display")
    for w in hits:
        if geom == "--close":
            X.XKillClient(d, w)
            continue
        size, _, pos = geom.partition("+")
        (wd, ht), (x, y) = map(int, size.split("x")), map(int, pos.split("+"))
        X.XMoveResizeWindow(d, w, x, y, wd, ht)
    X.XFlush(d)
    return len(hits)


if __name__ == "__main__":
    wait = float(sys.argv[sys.argv.index("--wait") + 1]) if "--wait" in sys.argv else 0.0
    n = act(sys.argv[1], sys.argv[2], wait)
    print(f"{sys.argv[1]!r}: {n} window(s) {sys.argv[2]}")
    sys.exit(0 if n else 1)
