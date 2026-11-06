"""In-process fake 0G Router for the CLI's test-only chaos modes (spec §10 T9). Never used for evidence: the CLI
labels every such run CHAOS MODE and writes `chaos` into the manifest. The real-outage demo is --chaos unreachable."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODES = ("ok", "timeout", "garbage", "r429", "r502")
TIMEOUT_S = 1.0  # client timeout used in timeout mode; the fake sleeps twice as long


class FakeRouter:
    def __init__(self, mode: str):
        assert mode in MODES, mode
        self.mode, self.seen = mode, []
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, status, raw: bytes, headers=None):
                self.send_response(status)
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                fake.seen.append((body.get("model"), self.headers.get("X-0G-Provider-Trust-Mode")))
                trace = {"X-Request-Id": f"fake-{len(fake.seen)}", "Zg-Res-Key": "fake"}
                chat = {"choices": [{"message": {"content": '{"action":"MAINTAIN","why":"fake"}'}}],
                        "x_0g_trace": {"request_id": f"fake-{len(fake.seen)}", "provider": "0xfake"}}
                if fake.mode == "ok":
                    return self._send(200, json.dumps(chat).encode(), trace)
                if fake.mode == "timeout":
                    time.sleep(2 * TIMEOUT_S)
                    return self._send(200, json.dumps(chat).encode(), trace)
                if fake.mode == "garbage":
                    return self._send(200, b"<html>oops</html>", trace)
                if fake.mode == "r429":
                    return self._send(429, b'{"error":{"code":"rate_limited"}}', {"Retry-After": "0"})
                return self._send(502, b'{"error":{"code":"bad_gateway"}}')

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v1"

    def __enter__(self):
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *a):
        self.server.shutdown()
        self.server.server_close()
