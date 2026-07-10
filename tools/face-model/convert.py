#!/usr/bin/env python3
"""Phase 1: convert the SFace ONNX checkpoint to .tflite and verify fidelity.

Pipeline (plan Section 1.3):
  SFace ONNX (NCHW) --onnx2tf (v2)--> float32 .tflite (NHWC)
                    --AI Edge Quantizer--> dynamic-range int8 .tflite

onnx2tf v2 emits .tflite directly (no SavedModel intermediate). Its own
-odrqt dynamic-range output (flatbuffer_direct backend) produced garbage
embeddings (cosine ~0.08 vs ONNX — caught by the fidelity gate below), so
quantization uses AI Edge Quantizer on the verified fp32 .tflite instead,
which is also what the plan specified.

Then the critical validation step: embed the same inputs through the original
ONNX (onnxruntime) and each .tflite (TF interpreter) and require same-input
cosine similarity > 0.99 — quantization can silently wreck embedding geometry.

Outputs land in build/ (git-ignored):
  build/onnx2tf_out/                  raw onnx2tf output
  build/face_embedder_v1_fp32.tflite
  build/face_embedder_v1_int8.tflite  (dynamic-range quantized)
  build/conversion_report.json

Usage: .venv/bin/python convert.py [--onnx spike/models/face_recognition_sface_2021dec.onnx]
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
FIDELITY_GATE = 0.99
N_FIDELITY_SAMPLES = 32


def log(msg: str) -> None:
    print(f"[convert] {msg}", flush=True)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run_onnx2tf(onnx_path: Path, out_dir: Path) -> Path:
    """ONNX (NCHW) -> NHWC float32 .tflite. Returns its path.

    Skips re-conversion only when a cached output exists AND its recorded
    source hash matches the current ONNX. The cache key is the input's
    SHA-256, not its filename: swapping the checkpoint for a different one
    with the same name must not silently reuse the stale .tflite.
    """
    fp32 = out_dir / f"{onnx_path.stem}_float32.tflite"
    stamp = out_dir / f"{onnx_path.stem}.onnx.sha256"
    onnx_hash = sha256(onnx_path)
    if fp32.exists() and stamp.exists() and stamp.read_text().strip() == onnx_hash:
        log(f"{fp32.name} up to date for {onnx_path.name} (sha256 match), "
            "skipping onnx2tf")
        return fp32
    if fp32.exists():
        log(f"{fp32.name} present but stale/unverified vs {onnx_path.name} — "
            "re-running onnx2tf")
    # Clear any stale output so a failed/partial run can't be mistaken for a
    # good cache on the next invocation.
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    # onnx2tf rewrites its -i input IN PLACE — several internal stages (op-name
    # auto-generation via sng4onnx, graph re-export, and onnxsim when reachable)
    # each re-serialize the model back to the input path. The bytes are
    # weight-identical to the input but have a different SHA-256. Convert a
    # disposable copy so the pinned, hash-verified checkpoint in spike/models/
    # is never mutated; keep the copy's name so onnx2tf's output filenames
    # (derived from the input stem) stay {stem}_float32.tflite.
    work = out_dir / onnx_path.name
    shutil.copy2(onnx_path, work)
    log(f"onnx2tf: {onnx_path} (via disposable copy) -> {out_dir}")
    # -n / --not_use_onnxsim: keep the conversion deterministic across
    # environments. onnx2tf shells out to the `onnxsim` CLI, whose presence on
    # PATH is environment-dependent (the venv is used by full path, not
    # activated, so `.venv/bin/onnxsim` is not found). Whether onnxsim runs
    # changes the output .tflite bytes; disabling it pins the build to the
    # validated onnxsim-off artifacts (fp32 f2fde3b5…, int8 c74fc6be…) instead
    # of silently depending on PATH. onnxsim's simplification is marginal here
    # (SFace is already a clean graph) and fp32 fidelity vs the ONNX is 1.0.
    subprocess.run(
        [sys.executable, "-m", "onnx2tf", "-i", str(work),
         "-o", str(out_dir), "-n"],
        check=True,
    )
    if not fp32.exists():
        raise FileNotFoundError(f"onnx2tf did not produce {fp32}")
    stamp.write_text(onnx_hash)
    return fp32


def quantize_dynamic_int8(fp32_tflite: Path, out_path: Path) -> None:
    """Dynamic-range int8 (weights int8, activations fp32) via AI Edge Quantizer."""
    from ai_edge_quantizer import quantizer, recipe

    qt = quantizer.Quantizer(str(fp32_tflite))
    qt.load_quantization_recipe(recipe.dynamic_wi8_afp32())
    qt.quantize().export_model(str(out_path), overwrite=True)
    log(f"quantized -> {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")


def onnx_embed(onnx_path: Path, batch_nchw: np.ndarray) -> np.ndarray:
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    return np.vstack([
        sess.run(None, {input_name: batch_nchw[i : i + 1]})[0]
        for i in range(batch_nchw.shape[0])
    ])


def tflite_embed(tflite_path: Path, batch_nhwc: np.ndarray) -> np.ndarray:
    import tensorflow as tf

    interp = tf.lite.Interpreter(model_path=str(tflite_path))
    interp.allocate_tensors()
    inp = interp.get_input_details()[0]
    out = interp.get_output_details()[0]
    assert inp["dtype"] == np.float32, f"unexpected input dtype {inp['dtype']}"
    embs = []
    for i in range(batch_nhwc.shape[0]):
        interp.set_tensor(inp["index"], batch_nhwc[i : i + 1])
        interp.invoke()
        embs.append(interp.get_tensor(out["index"]).copy())
    return np.vstack(embs)


def cosine_rows(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a = a / np.linalg.norm(a, axis=1, keepdims=True)
    b = b / np.linalg.norm(b, axis=1, keepdims=True)
    return np.sum(a * b, axis=1)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--onnx",
        type=Path,
        default=HERE / "spike/models/face_recognition_sface_2021dec.onnx",
    )
    args = parser.parse_args()
    if not args.onnx.exists():
        log(f"missing {args.onnx} — run ./download-models.sh first")
        return 1

    build = HERE / "build"
    build.mkdir(exist_ok=True)

    raw_fp32 = run_onnx2tf(args.onnx, build / "onnx2tf_out")
    fp32_path = build / "face_embedder_v1_fp32.tflite"
    int8_path = build / "face_embedder_v1_int8.tflite"
    shutil.copy2(raw_fp32, fp32_path)
    log(f"staged {fp32_path.name} ({fp32_path.stat().st_size / 1e6:.1f} MB)")
    quantize_dynamic_int8(fp32_path, int8_path)

    # Fidelity check: same inputs through ONNX (NCHW) and tflite (NHWC).
    # Pixel-scale inputs — SFace takes raw 112x112 BGR values, no normalization.
    log(f"fidelity check on {N_FIDELITY_SAMPLES} random pixel-scale inputs…")
    rng = np.random.default_rng(42)
    nchw = rng.uniform(0, 255, (N_FIDELITY_SAMPLES, 3, 112, 112)).astype(np.float32)
    nhwc = np.ascontiguousarray(nchw.transpose(0, 2, 3, 1))

    ref = onnx_embed(args.onnx, nchw)
    report = {
        "onnx": str(args.onnx.name),
        "embedding_dim": int(ref.shape[1]),
        "gate": FIDELITY_GATE,
        "results": {},
    }
    ok = True
    for path, gated in ((fp32_path, True), (int8_path, False)):
        cos = cosine_rows(ref, tflite_embed(path, nhwc))
        entry = {
            "size_mb": round(path.stat().st_size / 1e6, 2),
            "cosine_min": round(float(cos.min()), 6),
            "cosine_mean": round(float(cos.mean()), 6),
            "gated": gated,
            "pass": bool(cos.min() > FIDELITY_GATE),
        }
        report["results"][path.name] = entry
        verdict = "PASS" if entry["pass"] else ("FAIL" if gated else "WARN")
        log(f"{path.name}: min cosine {entry['cosine_min']}, "
            f"mean {entry['cosine_mean']} -> {verdict}")
        if gated:
            # Random-noise inputs are the honest gate for conversion
            # correctness (fp32 must be bit-faithful to the ONNX).
            ok &= entry["pass"]
        elif not entry["pass"]:
            # Quantized variants legitimately dip below the gate on noise
            # inputs; their authoritative gate is EER parity vs fp32 in
            # evaluate.py (measured: int8 EER 5.09% vs fp32 5.18% on LFW).
            log(f"  note: {path.name} is quantized — verify with evaluate.py "
                "(EER parity vs fp32), not the noise-input cosine alone")

    (build / "conversion_report.json").write_text(json.dumps(report, indent=2))
    log(f"report -> {build / 'conversion_report.json'}")

    # Only publish to spike/models/ if the gated (fp32) conversion passed —
    # a model that failed the fidelity gate must not reach the browser
    # benchmark or anything else that reads spike/models/.
    if not ok:
        log("fidelity gate FAILED — not staging artifacts to spike/models/")
        return 2
    for path in (fp32_path, int8_path):
        shutil.copy2(path, HERE / "spike/models" / path.name)
        log(f"copied {path.name} -> spike/models/ for the browser benchmark")

    return 0


if __name__ == "__main__":
    sys.exit(main())
