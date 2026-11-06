"""Write the demo BUYER dataset: synthetic ISP tickets (domain B) with rare outages, as JSONL. Synthetic only.

    uv run python tools/make_buyer_dataset.py ../../fixtures/buyer-isp-tickets.jsonl 1200
"""
import json
import sys
from pathlib import Path

from sealedai_ml.synthetic import tickets

out, n = Path(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 1200
rows = tickets("B", n, seed=2026, weights={"billing": 0.46, "outage": 0.1, "other": 0.44})
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text("".join(json.dumps(r) + "\n" for r in rows))
print(f"wrote {len(rows)} rows to {out}")
