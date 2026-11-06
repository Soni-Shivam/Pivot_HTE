"""Training, evaluation and inference for the text-classification task adapter (PLAN §3.3)."""
from __future__ import annotations

import copy
import math
import os
import time

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

import torch  # noqa: E402
from torch import nn  # noqa: E402

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def set_determinism(seed: int) -> None:
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True, warn_only=True)


def _batches(rows, tok, labels, max_len, batch, gen: torch.Generator | None = None):
    idx = torch.randperm(len(rows), generator=gen).tolist() if gen is not None else list(range(len(rows)))
    l2i = {l: i for i, l in enumerate(labels)}
    for i in range(0, len(idx), batch):
        part = [rows[j] for j in idx[i : i + batch]]
        enc = tok([r["text"] for r in part], truncation=True, max_length=max_len, padding=True, return_tensors="pt")
        y = torch.tensor([l2i[r["label"]] for r in part])
        yield {k: v.to(DEVICE) for k, v in enc.items()}, y.to(DEVICE)


@torch.no_grad()
def evaluate(model, tok, rows, labels, max_len=128) -> dict:
    """Loss, accuracy, macro-F1 and per-class F1. Rows whose gold label isn't in the label set count as errors."""
    model.eval().to(DEVICE)
    preds, golds, loss_sum = [], [], 0.0
    for x, y in _batches(rows, tok, labels, max_len, 64):
        logits = model(**x).logits
        loss_sum += nn.functional.cross_entropy(logits, y, reduction="sum").item()
        preds += logits.argmax(-1).tolist()
        golds += y.tolist()
    n = max(len(golds), 1)
    per = {}
    for i, lab in enumerate(labels):
        tp = sum(p == i and g == i for p, g in zip(preds, golds))
        fp = sum(p == i and g != i for p, g in zip(preds, golds))
        fn = sum(p != i and g == i for p, g in zip(preds, golds))
        f1 = 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else 0.0
        per[lab] = {"f1": f1, "n": sum(g == i for g in golds)}
    return {
        "valLoss": loss_sum / n,
        "valAccuracy": sum(p == g for p, g in zip(preds, golds)) / n,
        "valMacroF1": sum(v["f1"] for v in per.values()) / len(labels),
        "perClass": per,
    }


def _wrap(base, recipe: dict):
    model = copy.deepcopy(base)
    if recipe["method"] == "full":  # seller-side tooling only; not in the buyer recipe catalog (the gate rejects it)
        for p in model.parameters():
            p.requires_grad = True
        return model
    if recipe["method"] == "head_only":
        for name, p in model.named_parameters():
            p.requires_grad = name.startswith(("pre_classifier", "classifier"))
        return model
    from peft import LoraConfig, TaskType, get_peft_model

    lo = recipe["lora"]
    cfg = LoraConfig(task_type=TaskType.SEQ_CLS, r=lo["r"], lora_alpha=lo["alpha"], lora_dropout=lo["dropout"], target_modules=list(lo["targets"]))
    return get_peft_model(model, cfg)  # SEQ_CLS keeps the classifier head trainable


def train(base, tok, train_rows, labels, recipe: dict, seed: int, gpu_seconds_budget: float) -> tuple[object, dict]:
    """Train a fresh copy of the seller model with one recipe. Returns (model, {trainLoss, gpuSeconds, stoppedByBudget})."""
    set_determinism(seed)
    model = _wrap(base, recipe).to(DEVICE)
    model.train()
    o = recipe["optim"]
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=o["lr"], weight_decay=0.01)
    steps_per_epoch = math.ceil(len(train_rows) / o["batch"])
    total = steps_per_epoch * o["epochs"]
    warm = int(total * o["warmup"])
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: (s + 1) / max(warm, 1) if s < warm else max(0.0, (total - s) / max(total - warm, 1)))
    weight = None
    if recipe["classWeights"] == "balanced":
        counts = torch.tensor([max(sum(r["label"] == l for r in train_rows), 1) for l in labels], dtype=torch.float)
        weight = (counts.sum() / (len(labels) * counts)).to(DEVICE)
    gen = torch.Generator().manual_seed(seed)
    t0 = time.perf_counter()
    stopped, last_epoch_losses = False, []
    for _ in range(o["epochs"]):
        last_epoch_losses = []
        for x, y in _batches(train_rows, tok, labels, recipe["maxLen"], o["batch"], gen):
            loss = nn.functional.cross_entropy(model(**x).logits, y, weight=weight)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            last_epoch_losses.append(loss.item())
            if DEVICE == "cuda":
                torch.cuda.synchronize()
            if time.perf_counter() - t0 > gpu_seconds_budget:
                stopped = True
                break
        if stopped:
            break
    model.eval()
    return model, {
        "trainLoss": sum(last_epoch_losses) / max(len(last_epoch_losses), 1),
        "gpuSeconds": round(time.perf_counter() - t0, 3),
        "stoppedByBudget": stopped,
    }


@torch.no_grad()
def predict(model, tok, text: str, labels, max_len=128) -> str:
    """Always returns a member of `labels` (SECURITY I7): the output is an argmax over the label set."""
    model.eval().to(DEVICE)
    x = tok([text], truncation=True, max_length=max_len, return_tensors="pt").to(DEVICE)
    return labels[int(model(**x).logits.argmax(-1).item())]
