"""Seeded 60/20/20 split and the holdout lock (PLAN §3.3, SECURITY I6)."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field


class HoldoutLocked(Exception):
    pass


@dataclass
class Splits:
    train: list[dict]
    val: list[dict]
    _holdout: list[dict] = field(repr=False)
    _unlocked: bool = False
    _used: bool = False

    def unlock(self) -> None:
        self._unlocked = True

    def holdout(self) -> list[dict]:
        """Readable only after unlock(), and only once."""
        if not self._unlocked:
            raise HoldoutLocked("holdout is locked until the agent finishes")
        if self._used:
            raise HoldoutLocked("holdout may be evaluated only once")
        self._used = True
        return self._holdout

    @property
    def holdout_size(self) -> int:
        return len(self._holdout)


def split(rows: list[dict], seed: bytes) -> Splits:
    """Bucket each row by sha256(seed || index): 0-59 train, 60-79 val, 80-99 holdout. Deterministic given the seed
    committed in the manifest; nobody can steer rows into the holdout without knowing the seed."""
    train, val, hold = [], [], []
    for i, r in enumerate(rows):
        b = int.from_bytes(hashlib.sha256(seed + i.to_bytes(8, "big")).digest()[:4], "big") % 100
        (train if b < 60 else val if b < 80 else hold).append(r)
    return Splits(train, val, hold)


def summary(s: Splits, tokenizer=None) -> dict:
    """Numeric summary of train + val only (never holdout): what the agent may see."""
    rows = s.train + s.val
    hist: dict[str, int] = {}
    for r in rows:
        hist[r["label"]] = hist.get(r["label"], 0) + 1
    lens = sorted(len(tokenizer(r["text"])["input_ids"]) if tokenizer else len(r["text"].split()) for r in rows) or [0]
    pick = lambda q: lens[min(len(lens) - 1, int(q * len(lens)))]  # noqa: E731
    return {"rows": {"train": len(s.train), "val": len(s.val)}, "labelHistogram": hist, "tokenLenP50": pick(0.5), "tokenLenP95": pick(0.95)}
