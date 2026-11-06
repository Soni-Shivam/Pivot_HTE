"""Synthetic support-ticket data for tests and demos (never real data). Two domains share one label set, so a model
the "seller" trained on a generic SaaS domain is a reasonable but imperfect start for a "buyer" ISP domain. That
shift is what customization has to fix."""
from __future__ import annotations

import random

LABELS = ["billing", "outage", "other"]

_A = {  # seller domain: generic SaaS
    "billing": [
        "I was charged twice for my {plan} subscription this month",
        "please refund invoice {n}, the amount is wrong",
        "why did my card get billed {amt} dollars",
        "cancel my {plan} plan and stop charging me",
        "the receipt for order {n} shows the wrong tax",
    ],
    "outage": [
        "the {svc} is down and nothing loads",
        "your website returns error 500 since {time}",
        "cannot log in, the {svc} times out for everyone",
        "the API is not responding at all right now",
        "dashboard is completely broken, blank page",
    ],
    "other": [
        "how do I change my {setting}",
        "feature request: please add {feature}",
        "can you export my data as csv",
        "where can I find the documentation for {feature}",
        "I want to invite a teammate to the workspace",
    ],
}
_B = {  # buyer domain: home internet / mobile ISP
    "billing": [
        "my {month} bill has a roaming charge I never used",
        "direct debit failed for account {n}, please retry",
        "you charged me an early termination fee of {amt}",
        "the promo discount is missing from my {month} invoice",
        "why is my phone bill {amt} higher than last {month}",
        "set up autopay on account {n}",
    ],
    "outage": [
        "no signal in {area} since {time}",
        "fibre keeps dropping every few minutes in {area}",
        "router lights are red and there is no internet",
        "whole street in {area} has no broadband since {time}",
        "mobile data stopped working in {area} this morning",
        "line is dead, cannot call out or get online",
    ],
    "other": [
        "I want to port my number to a new sim",
        "upgrade me to the {plan} handset deal",
        "is there maintenance planned in {area} next week",
        "how do I change my wifi password",
        "can I add a second line for my kid",
        "moving house, transfer my broadband to the new address",
    ],
}
_FILL = {
    "plan": ["pro", "team", "basic", "enterprise", "unlimited 5G"],
    "n": ["#4411", "#9302", "A-2271", "77-104", "#1288"],
    "amt": ["$49", "$12.50", "$120", "$7", "$310"],
    "svc": ["app", "portal", "service", "sync server", "login page"],
    "time": ["9am", "last night", "an hour ago", "yesterday", "noon"],
    "setting": ["email address", "time zone", "password", "billing contact", "language"],
    "feature": ["dark mode", "SSO", "webhooks", "audit logs", "2FA"],
    "month": ["march", "april", "may", "june", "july"],
    "area": ["Andheri", "Bandra", "Powai", "Thane", "Colaba", "Dadar"],
}


def _fill(t: str, rng: random.Random) -> str:
    out = t
    for k, vals in _FILL.items():
        while "{" + k + "}" in out:
            out = out.replace("{" + k + "}", rng.choice(vals), 1)
    return out


def tickets(domain: str, n: int, seed: int, weights: dict[str, float] | None = None, label_noise: float = 0.03) -> list[dict]:
    """n rows of {text, label}. `weights` sets the class mix (default balanced); a small label noise keeps it honest."""
    src = {"A": _A, "B": _B}[domain]
    rng = random.Random(seed)
    w = weights or {lab: 1.0 for lab in LABELS}
    labs, ps = zip(*w.items())
    rows = []
    for _ in range(n):
        lab = rng.choices(labs, ps)[0]
        text = _fill(rng.choice(src[lab]), rng)
        if rng.random() < 0.3:
            text = rng.choice(["hi, ", "hello team, ", "urgent: ", "", "pls help - "]) + text
        if rng.random() < label_noise:
            lab = rng.choice([x for x in LABELS if x != lab])
        rows.append({"text": text, "label": lab})
    return rows
