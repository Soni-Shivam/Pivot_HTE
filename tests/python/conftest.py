import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


@pytest.fixture
def tmp_run_dir(tmp_path):
    d = tmp_path / "runs" / "ep"
    d.mkdir(parents=True)
    return d
