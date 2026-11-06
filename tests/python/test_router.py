"""ZgRouter against a local fake Router (threaded http.server). No network."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from faultline.policy import ACTIONS
from faultline.router import Decision, ZgRouter

MODE = "ok"
SEEN = []  # (model, trust header) of every request the fake received
BODIES = []  # request bodies, newest last

OBS = {"schema": "faultline.obs/v1", "checkpoint": 7, "sim_time_s": 7.0, "lead_speed_mps": 17.5,
       "ego_speed_mps": 23.1, "gap_m": 21.0, "closing_speed_mps": 5.6, "ttc_s": 3.75, "thw_s": 0.91,
       "available_actions": list(ACTIONS)}


def _chat(content, trace=True):
    body = {"id": "chat-1", "choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}]}
    if trace:
        body["x_0g_trace"] = {"request_id": "r1", "provider": "0xabc", "billing": {}}
    return body


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body, headers=None):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        trust = self.headers.get("X-0G-Provider-Trust-Mode")
        SEEN.append((body.get("model"), trust))
        BODIES.append(body)
        if trust != "private" or body.get("model") != "0gm-1.0-35b-a3b" or self.path != "/v1/chat/completions":
            return self._send(400, {"error": {"code": "bad_test_request"}})
        n = sum(1 for _ in SEEN)
        trace_hdr = {"X-Request-Id": "r1", "Zg-Res-Key": "k1", "X-Ratelimit-Remaining-Requests": "499"}
        if MODE == "ok":
            return self._send(200, _chat('{"action":"BRAKE_SOFT","why":"w"}'), trace_hdr)
        if MODE == "prose":
            return self._send(200, _chat('Sure! {"action":"COAST"}'), trace_hdr)
        if MODE == "out_of_set":
            return self._send(200, _chat('{"action":"BRAKE"}'), trace_hdr)
        if MODE == "r429_then_ok":
            if n == 1:
                return self._send(429, {"error": {"code": "rate_limited"}}, {"Retry-After": "0"})
            return self._send(200, _chat('{"action":"COAST","why":"w"}'), trace_hdr)
        if MODE == "r429":
            return self._send(429, {"error": {"code": "rate_limited"}}, {"Retry-After": "0"})
        if MODE == "r502":
            return self._send(502, {"error": {"code": "bad_gateway"}})
        if MODE == "r503_trust":
            return self._send(503, {"error": {"code": "no_provider_for_trust_mode", "message": "none"}})
        if MODE == "no_reqid":
            return self._send(200, _chat('{"action":"COAST"}', trace=False))
        if MODE == "slow":
            time.sleep(2)
            return self._send(200, _chat('{"action":"COAST"}'), trace_hdr)
        if MODE == "dup_reqid":  # the live Router repeats X-Request-Id (gateway id + 0G id)
            self.send_response(200)
            raw = json.dumps(_chat('{"action":"COAST"}')).encode()
            for v in ("gw1", "r1"):
                self.send_header("X-Request-Id", v)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            return self.wfile.write(raw)
        if MODE == "garbage":
            return self._send(200, b"<html>oops</html>", trace_hdr)


@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/v1"
    srv.shutdown()


def run(server, mode, **kw):
    global MODE
    MODE = mode
    SEEN.clear()
    d = ZgRouter(server, "sk-test", **kw).decide(OBS, [], ACTIONS)
    assert isinstance(d, Decision) and d.model == "0gm-1.0-35b-a3b"
    return d


def test_ok_decision_records_trace(server):
    d = run(server, "ok")
    assert (d.action, d.reason, d.request_id, d.zg_res_key, d.provider) == ("BRAKE_SOFT", "ok", "r1", "k1", "0xabc")
    assert d.latency_ms >= 0 and len(d.raw_sha256) == 64 and d.http_status == 200 and d.ratelimit_remaining == 499
    assert d.content == '{"action":"BRAKE_SOFT","why":"w"}'
    import base64, hashlib
    assert hashlib.sha256(base64.b64decode(d.raw_b64)).hexdigest() == d.raw_sha256  # exact body kept for content binding
    assert run(server, "dup_reqid").request_id == "r1"  # x_0g_trace.request_id wins over a repeated header


def test_prose_and_out_of_set_are_failures(server):
    for mode, reason in [("prose", "invalid_json"), ("out_of_set", "out_of_set"), ("garbage", "invalid_json")]:
        d = run(server, mode)
        assert (d.action, d.reason, d.request_id) == (None, reason, "r1") and len(SEEN) == 1


def test_429_retries_once_then_fails(server):
    d = run(server, "r429_then_ok")
    assert (d.action, d.reason) == ("COAST", "ok") and len(SEEN) == 2
    d = run(server, "r429")
    assert (d.action, d.reason, d.http_status) == (None, "http_429", 429) and len(SEEN) == 2


def test_502_503_no_reqid(server):
    for mode, reason in [("r502", "http_5xx"), ("r503_trust", "no_provider_for_trust_mode"), ("no_reqid", "no_request_id")]:
        d = run(server, mode)
        assert (d.action, d.reason) == (None, reason) and len(SEEN) == 1


def test_timeout_and_unreachable(server):
    d = run(server, "slow", timeout_s=0.5)
    assert (d.action, d.reason, d.http_status) == (None, "timeout", None)
    d = ZgRouter("http://127.0.0.1:1/v1", "sk-test").decide(OBS, [], ACTIONS)
    assert (d.action, d.reason, d.request_id) == (None, "unreachable", None)


def test_never_changes_model_or_tier(server):
    for mode in ["r502", "r503_trust", "r429", "prose", "no_reqid", "garbage"]:
        run(server, mode)
        assert SEEN and all(s == ("0gm-1.0-35b-a3b", "private") for s in SEEN)


def test_family_prompt_is_sent_and_parser_stays_strict(server):
    from faultline import cutin, policy
    global MODE
    MODE = "ok"  # the fake answers BRAKE_SOFT, which is not a cut-in action
    d = ZgRouter(server, "sk-test").decide(OBS, [], ACTIONS)
    assert BODIES[-1]["messages"][0]["content"] == policy.SYSTEM_PROMPT and d.action == "BRAKE_SOFT"
    d = ZgRouter(server, "sk-test", system_prompt=cutin.SYSTEM_PROMPT).decide(OBS, [], cutin.ACTIONS)
    assert BODIES[-1]["messages"][0]["content"] == cutin.SYSTEM_PROMPT
    assert (d.action, d.reason, d.request_id) == (None, "out_of_set", "r1")
    assert SEEN[-1] == ("0gm-1.0-35b-a3b", "private")
