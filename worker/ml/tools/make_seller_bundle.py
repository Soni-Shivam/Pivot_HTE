"""Build the demo SELLER asset: distilbert-base-uncased fine-tuned on synthetic generic-SaaS tickets (domain A), saved
as an hf-safetensors/v1 bundle with card.json (PROTOCOL §4). Synthetic data only.

    uv run python tools/make_seller_bundle.py models/distilbert-base-uncased models/seller-triage-v1
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from transformers import AutoModelForSequenceClassification, AutoTokenizer

from sealedai_ml import engine
from sealedai_ml.synthetic import LABELS, tickets

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
tok = AutoTokenizer.from_pretrained(src, local_files_only=True)
model = AutoModelForSequenceClassification.from_pretrained(
    src, num_labels=len(LABELS), id2label=dict(enumerate(LABELS)), label2id={l: i for i, l in enumerate(LABELS)}, local_files_only=True
)
rows = tickets("A", 1500, seed=1)
recipe = {"method": "full", "optim": {"lr": 5e-5, "epochs": 2, "batch": 16, "warmup": 0.06}, "classWeights": "none", "maxLen": 128}
# full fine-tune for the seller's own training (not a buyer recipe): every parameter trainable
trained, info = engine.train(model, tok, rows, LABELS, recipe, seed=1, gpu_seconds_budget=600)
print("seller training", info, "seller-domain val", {k: v for k, v in engine.evaluate(trained, tok, tickets("A", 300, seed=2), LABELS).items() if k != "perClass"})

if dst.exists():
    shutil.rmtree(dst)
dst.mkdir(parents=True)
trained.config.architectures = ["DistilBertForSequenceClassification"]
trained.save_pretrained(dst, safe_serialization=True)
tok.save_pretrained(dst)
for f in list(dst.iterdir()):  # keep only the allowlisted files
    if f.name not in {"config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "vocab.txt"}:
        f.unlink()
card = {
    "name": "ticket-triage-distilbert",
    "task": "text-classification",
    "architecture": "DistilBertForSequenceClassification",
    "parameters": trained.num_parameters(),
    "license": "demo-proprietary",
    "labels": LABELS,
    "inputSchema": {"text": "string"},
    "outputSchema": {"label": LABELS},
    "allowedTargets": ["q_lin", "v_lin"],
    "maxLen": 128,
    "publicDescription": "Support-ticket triage model (billing / outage / other), trained on SaaS tickets. Customizable with LoRA on q_lin, v_lin.",
}
(dst / "card.json").write_text(json.dumps(card, indent=2))
print("bundle", sorted(p.name for p in dst.iterdir()))
