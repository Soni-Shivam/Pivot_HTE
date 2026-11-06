"""Hash-chained JSONL log: each line carries `i` and `prev_hash`; entry_hash = sha256(canonical line)."""
import hashlib
import json
from pathlib import Path

from faultline.config import canonical

GENESIS = "0" * 64


class ChainLog:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.write_text("")
        self.i, self.head = 0, GENESIS

    def append(self, entry: dict) -> str:
        line = canonical({**entry, "i": self.i, "prev_hash": self.head})
        with self.path.open("a") as f:
            f.write(line + "\n")
        self.i += 1
        self.head = hashlib.sha256(line.encode()).hexdigest()
        return self.head


def verify_chain(path, head: str | None = None) -> bool:
    """True if every line is canonical, numbered in order and links to the previous line's hash (and, when `head`
    is given, the last hash equals it, which also catches an edit of the last line)."""
    h = GENESIS
    try:
        for i, line in enumerate(Path(path).read_text().splitlines()):
            e = json.loads(line)
            if canonical(e) != line or e.get("i") != i or e.get("prev_hash") != h:
                return False
            h = hashlib.sha256(line.encode()).hexdigest()
    except (ValueError, UnicodeDecodeError):
        return False
    return head is None or h == head
