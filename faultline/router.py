"""0G Router client for one checkpoint decision. Private tier only, fail-closed (SECURITY I9, spec §5.4-§5.5).

Any failure returns a Decision with action None and a reason; the caller turns that into SAFE_HALT. There is no
retry on another tier or model; the only retry is one after an HTTP 429.
"""
import base64
import hashlib
import time
from dataclasses import dataclass

import requests

from faultline.policy import SYSTEM_PROMPT, build_user_message, parse_decision

DEFAULT_MODEL = "0gm-1.0-35b-a3b"
# USD per million (input, output) tokens. Source: live 0G Router model card, recorded in
# docs/superpowers/specs/2026-11-06-faultline-0g-architecture-design.md (§5.3 facts table): 0GM $0.08/M in, $0.48/M out.
# The Router's own x_0g_trace.billing.total_cost_usd_micro wins when present (cost_usd below).
PRICE_USD_PER_M = {"0gm-1.0-35b-a3b": (0.08, 0.48)}


def cost_usd(usage, billing=None, model: str = DEFAULT_MODEL) -> float | None:
    """Cost of one call: the Router's billed micro-USD if it sent it, else tokens x PRICE_USD_PER_M, else None."""
    try:
        return int((billing or {})["total_cost_usd_micro"]) / 1e6
    except (KeyError, TypeError, ValueError):
        pass
    if not isinstance(usage, dict) or model not in PRICE_USD_PER_M:
        return None
    pin, pout = PRICE_USD_PER_M[model]
    return ((usage.get("prompt_tokens") or 0) * pin + (usage.get("completion_tokens") or 0) * pout) / 1e6


def usage_of(raw_json) -> tuple[dict | None, float | None]:
    """(usage, cost_usd) from a parsed Router response body."""
    j = raw_json if isinstance(raw_json, dict) else {}
    usage = j.get("usage") if isinstance(j.get("usage"), dict) else None
    trace = j.get("x_0g_trace") if isinstance(j.get("x_0g_trace"), dict) else {}
    return usage, cost_usd(usage, trace.get("billing") if isinstance(trace.get("billing"), dict) else None,
                           j.get("model") if j.get("model") in PRICE_USD_PER_M else DEFAULT_MODEL)


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
    # Full Router response body (base64), sealed only: the provider signs sha256(response body), so content binding
    # (audit A2) needs the exact bytes, not just raw_sha256.
    raw_b64: str | None = None
    # Nonce sent in this request's binding (anchored runs); an "ok" decision echoed exactly this (parse_decision).
    nonce: str | None = None
    # Token usage as the Router reported it and the call's cost (cost_usd()); appended last, never reordered.
    usage: dict | None = None
    cost_usd: float | None = None


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class ZgRouter:
    def __init__(self, base_url: str, api_key: str, model: str = DEFAULT_MODEL, timeout_s: float = 8.0, http=requests,
                 system_prompt: str = SYSTEM_PROMPT, binding: dict | None = None):
        self.binding = binding  # set by `run --anchor` after the Galileo commit (audit A3)
        self.system_prompt = system_prompt  # per scenario family (policy / cutin); the parser stays strict for all
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
            "messages": [{"role": "system", "content": self.system_prompt},
                         {"role": "user", "content": build_user_message(obs, history, self.binding)}],
            "response_format": {"type": "json_object"},
            "chat_template_kwargs": {"enable_thinking": False},
            "temperature": 0,
            "max_tokens": 120,
        }
        t0 = time.monotonic()

        def out(reason, r=None, action=None, request_id=None, provider=None, content=None):
            try:
                usage, cost = usage_of(r.json()) if r is not None else (None, None)
            except ValueError:
                usage, cost = None, None
            return Decision(action=action, reason=reason, request_id=request_id, provider=provider,
                            zg_res_key=r.headers.get("Zg-Res-Key") if r is not None else None, model=self.model,
                            latency_ms=int((time.monotonic() - t0) * 1000),
                            http_status=r.status_code if r is not None else None,
                            raw_sha256=hashlib.sha256(r.content).hexdigest() if r is not None else None,
                            content=content,
                            ratelimit_remaining=_int(r.headers.get("X-Ratelimit-Remaining-Requests")) if r is not None else None,
                            raw_b64=base64.b64encode(r.content).decode() if r is not None else None,
                            nonce=self.binding["nonce"] if self.binding else None, usage=usage, cost_usd=cost)

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
        action, reason = parse_decision(content if isinstance(content, str) else "", available,
                                        self.binding["nonce"] if self.binding else None)
        return out(reason, r, action=action, request_id=request_id, provider=provider,
                   content=content if isinstance(content, str) else None)
