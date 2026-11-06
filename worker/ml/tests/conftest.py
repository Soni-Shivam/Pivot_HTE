import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "models" / "distilbert-base-uncased"
SELLER = ROOT / "models" / "seller-triage-v1"


@pytest.fixture(scope="session")
def seller_bundle() -> Path:
    if not (SELLER / "card.json").exists():
        if not (BASE / "model.safetensors").exists():
            pytest.skip("download distilbert-base-uncased into worker/ml/models first (see README)")
        subprocess.run([sys.executable, str(ROOT / "tools" / "make_seller_bundle.py"), str(BASE), str(SELLER)], check=True, cwd=ROOT)
    return SELLER


@pytest.fixture
def bundle_copy(seller_bundle, tmp_path) -> Path:
    """A throwaway copy; the big weights file is hard-linked unless a test rewrites it."""
    d = tmp_path / "bundle"
    d.mkdir()
    for f in seller_bundle.iterdir():
        if f.name == "model.safetensors":
            os.link(f, d / f.name)
        else:
            shutil.copy(f, d / f.name)
    return d
