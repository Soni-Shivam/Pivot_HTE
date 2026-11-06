"""Safe model loader (PROTOCOL §4, SECURITY I4). Only standard formats: safetensors weights + config for allowlisted
architectures, no pickle, no remote code, no unexpected files. A seller's bundle is data, never code."""
from __future__ import annotations

import json
import struct
from pathlib import Path

ALLOWED_FILES = {
    "config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json",
    "special_tokens_map.json", "vocab.txt", "card.json",
}
# architecture -> config.model_type. Extending this is a reviewed code change.
ALLOWED_ARCH = {
    "DistilBertForSequenceClassification": "distilbert",
    "BertForSequenceClassification": "bert",
}
SAFE_DTYPES = {"F32", "F16", "BF16", "I64", "I32", "U8", "BOOL"}
MAX_HEADER = 100 * 1024 * 1024


class BundleRejected(Exception):
    pass


def check_safetensors(path: Path) -> None:
    """Validate the header ourselves: sane size, known dtypes, offsets inside the file, contiguous and non-overlapping."""
    size = path.stat().st_size
    with path.open("rb") as f:
        raw = f.read(8)
        if len(raw) != 8:
            raise BundleRejected("safetensors file too short")
        (n,) = struct.unpack("<Q", raw)
        if n <= 0 or n > MAX_HEADER or 8 + n > size:
            raise BundleRejected("safetensors header length is invalid")
        try:
            header = json.loads(f.read(n))
        except json.JSONDecodeError as e:
            raise BundleRejected(f"safetensors header is not JSON: {e}") from e
    spans = []
    for name, info in header.items():
        if name == "__metadata__":
            continue
        if info.get("dtype") not in SAFE_DTYPES:
            raise BundleRejected(f"tensor {name} has disallowed dtype {info.get('dtype')}")
        start, end = info["data_offsets"]
        if not (0 <= start <= end <= size - 8 - n):
            raise BundleRejected(f"tensor {name} points outside the file")
        spans.append((start, end))
    spans.sort()
    pos = 0
    for s, e in spans:
        if s != pos:
            raise BundleRejected("tensor data overlaps or leaves gaps")
        pos = e
    if pos != size - 8 - n:
        raise BundleRejected("tensor data does not cover the file exactly")


def inspect_bundle(d: Path) -> tuple[dict, dict]:
    """Static checks before any library touches the files. Returns (config, card)."""
    files = {p.name for p in d.iterdir()}
    extra = files - ALLOWED_FILES
    if extra:
        raise BundleRejected(f"unexpected files in bundle: {sorted(extra)}")
    for required in ("config.json", "model.safetensors", "card.json"):
        if required not in files:
            raise BundleRejected(f"missing {required}")
    if not ({"tokenizer.json", "vocab.txt"} & files):
        raise BundleRejected("missing tokenizer files")
    config = json.loads((d / "config.json").read_text())
    card = json.loads((d / "card.json").read_text())
    tok_cfg = json.loads((d / "tokenizer_config.json").read_text()) if (d / "tokenizer_config.json").exists() else {}
    if "auto_map" in config or "auto_map" in tok_cfg:
        raise BundleRejected("auto_map (custom code) is not allowed")
    arch = (config.get("architectures") or [None])[0]
    if arch not in ALLOWED_ARCH:
        raise BundleRejected(f"architecture {arch!r} is not on the allowlist")
    if config.get("model_type") != ALLOWED_ARCH[arch]:
        raise BundleRejected(f"model_type {config.get('model_type')!r} does not match {arch}")
    if card.get("architecture") != arch:
        raise BundleRejected("card.json architecture does not match config.json")
    labels = card.get("labels") or []
    id2label = {int(k): v for k, v in (config.get("id2label") or {}).items()}
    if not labels or [id2label.get(i) for i in range(len(labels))] != labels:
        raise BundleRejected("config id2label does not match card labels")
    check_safetensors(d / "model.safetensors")
    return config, card


def load_bundle(d: str | Path):
    """Returns (model, tokenizer, card). Raises BundleRejected on anything outside the rules."""
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    d = Path(d)
    _, card = inspect_bundle(d)
    try:
        model = AutoModelForSequenceClassification.from_pretrained(
            d, trust_remote_code=False, use_safetensors=True, local_files_only=True
        )
        tok = AutoTokenizer.from_pretrained(d, trust_remote_code=False, local_files_only=True)
    except Exception as e:  # shape mismatches, corrupt tensors
        raise BundleRejected(f"model failed to load: {e}") from e
    n = model.num_parameters()
    if abs(n - int(card["parameters"])) > 0.01 * int(card["parameters"]):
        raise BundleRejected(f"parameter count {n} differs from card {card['parameters']} by more than 1%")
    return model, tok, card
