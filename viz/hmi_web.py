#!/usr/bin/env python3
"""Serve the Lichtblick web app (open-source Foxglove Studio fork, installed by SeDriCa's
tools/install_lichtblick.sh) plus viz/faultline_hmi.json, so one URL opens the HMI connected to foxglove_bridge:

    http://localhost:8780/   -> /?ds=foxglove-websocket&ds.url=ws://localhost:8765&layoutUrl=.../faultline_hmi.json

Adapted from sedrica_hmi/hmi_web.py (the user's own repo). Binds to localhost only.
"""
import functools
import http.server
import os
import socketserver
import sys
import urllib.parse
from pathlib import Path

APP = Path(os.environ.get("LICHTBLICK_WEB", "~/.local/share/sedrica_hmi/lichtblick-web")).expanduser()
LAYOUT = Path(__file__).resolve().parent / "faultline_hmi.json"
CLOSE_SIDEBAR = (b'<script>addEventListener("load",()=>setTimeout(()=>document.body.dispatchEvent(new KeyboardEvent('
                 b'"keydown",{key:"[",code:"BracketLeft",bubbles:true})),5000))</script>')
PORT, BRIDGE = int(os.environ.get("HMI_PORT", 8780)), int(os.environ.get("BRIDGE_PORT", 8765))


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if urllib.parse.urlsplit(path).path == "/layouts/faultline_hmi.json":
            return str(LAYOUT)
        return super().translate_path(path)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path in ("/", "/index.html") and "ds" not in urllib.parse.parse_qs(url.query):
            host = self.headers.get("Host", f"localhost:{PORT}")
            q = urllib.parse.urlencode({"ds": "foxglove-websocket", "ds.url": f"ws://localhost:{BRIDGE}",
                                        "layoutUrl": f"http://{host}/layouts/faultline_hmi.json"})
            self.send_response(302)
            self.send_header("Location", f"/?{q}")
            self.end_headers()
            return
        if url.path in ("/", "/index.html"):  # fresh profile each start: close the left settings sidebar once ("[")
            body = (APP / "index.html").read_bytes().replace(b"</head>", CLOSE_SIDEBAR + b"</head>", 1)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    if not (APP / "index.html").is_file():
        sys.exit(f"no Lichtblick web app in {APP} (run SeDriCa's tools/install_lichtblick.sh)")
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=str(APP))) as s:
        print(f"HMI at http://localhost:{PORT}/", flush=True)
        s.serve_forever()
