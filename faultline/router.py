"""0G Router client for one checkpoint decision. Private tier only, fail-closed (SECURITY I9, spec §5.4-§5.5).

Any failure returns a Decision with action None and a reason; the caller turns that into SAFE_HALT. There is no
retry on another tier or model; the only retry is one after an HTTP 429.
"""
import hashlib
import time
from dataclasses import dataclass

import requests

from faultline.policy import SYSTEM_PROMPT, build_user_message, parse_decision

DEFAULT_MODEL = "0gm-1.0-35b-a3b"


@dataclass
class Decision:
    action: str | None
    reason: str
    request_id: str | None
    provider: str | None
    zg_res_key: str | None
    model: str
    latency_ms: int
    http_status: int | None
    raw_sha256: str | None
    content: str | None
    ratelimit_remaining: int | None


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class ZgRouter:
    def __init__(self, base_url: str, api_key: str, model: str = DEFAULT_MODEL, timeout_s: float = 8.0, http=requests):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self._key = api_key
        self.model = model
        self.timeout_s = timeout_s
        self.http = http

    def __repr__(self):  # never show the key
        return f"ZgRouter(url={self.url!r}, model={self.model!r})"

    def _post(self, body: dict):
        headers = {"Authorization": f"Bearer {self._key}", "X-0G-Provider-Trust-Mode": "private",
                   "Content-Type": "application/json"}
        # shortcut: requests' timeout is per socket operation, not total wall time; fine for a JSON reply of <1 kB
        return self.http.post(self.url, json=body, headers=headers, timeout=self.timeout_s)

    def decide(self, obs: dict, history, available: tuple[str, ...]) -> Decision:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                         {"role": "user", "content": build_user_message(obs, history)}],
            "response_format": {"type": "json_object"},
            "chat_template_kwargs": {"enable_thinking": False},
            "temperature": 0,
            "max_tokens": 120,
        }
        t0 = time.monotonic()

        def out(reason, r=None, action=None, request_id=None, provider=None, content=None):
            return Decision(action=action, reason=reason, request_id=request_id, provider=provider,
                            zg_res_key=r.headers.get("Zg-Res-Key") if r is not None else None, model=self.model,
                            latency_ms=int((time.monotonic() - t0) * 1000),
                            http_status=r.status_code if r is not None else None,
                            raw_sha256=hashlib.sha256(r.content).hexdigest() if r is not None else None,
                            content=content,
                            ratelimit_remaining=_int(r.headers.get("X-Ratelimit-Remaining-Requests")) if r is not None else None)

        try:
            r = self._post(body)
            if r.status_code == 429:
                retry_after = _int(r.headers.get("Retry-After"))
                time.sleep(min(retry_after if retry_after is not None else 1, 5))
                r = self._post(body)
        except requests.Timeout:
            return out("timeout")
        except requests.RequestException:
            return out("unreachable")

        try:
            j = r.json()
        except ValueError:
            j = None
        j = j if isinstance(j, dict) else {}
        if r.status_code != 200:
            code = (j.get("error") or {}).get("code") if isinstance(j.get("error"), dict) else None
            if r.status_code == 429:
                return out("http_429", r)
            if r.status_code == 503 and code == "no_provider_for_trust_mode":
                return out("no_provider_for_trust_mode", r)
            return out("http_5xx" if r.status_code >= 500 else "http_other", r)

        trace = j.get("x_0g_trace") if isinstance(j.get("x_0g_trace"), dict) else {}
        # The live Router sends X-Request-Id twice (requests joins them with ", "), so 0G's own trace id comes first.
        request_id = trace.get("request_id") or r.headers.get("X-Request-Id")
        provider = trace.get("provider")
        if not request_id:
            return out("no_request_id", r, provider=provider)
        try:
            content = j["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            content = None
        action, reason = parse_decision(content if isinstance(content, str) else "", available)
        return out(reason, r, action=action, request_id=request_id, provider=provider,
                   content=content if isinstance(content, str) else None)
