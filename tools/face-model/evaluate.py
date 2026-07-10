#!/usr/bin/env python3
"""Phase 1: offline model-quality harness (plan Sections 1.3 / 8.1).

Runs the LFW pairs protocol against the converted embedder:

  LFW pair -> YuNet detect (per image) -> SFace alignCrop (OpenCV, landmark
  alignment) -> embed via .tflite -> cosine similarity

and reports ROC / FAR-FRR, EER, and the recommended `face_match_threshold`
at the target FAR from plan Section 1.2 (balanced: FAR ~0.1%).

Alignment note: this harness aligns with OpenCV's YuNet+SFace alignCrop —
the browser pipeline will align with MediaPipe landmarks. Small skew is
expected; shadow mode (plan Section 8.3) is the real-world validation.

Dataset: LFW pairs parquet mirrored on Hugging Face (logasja/lfw; original
figshare/UMass hosts used by scikit-learn's fetch_lfw_pairs are dead — 403 /
NXDOMAIN as of 2026-07). ~58 MB per split, cached in build/datasets/.
2200 pairs per split (1100 same + 1100 different).

Usage:
  .venv/bin/python evaluate.py                       # int8 tflite, test split
  .venv/bin/python evaluate.py --subset train        # other split
  .venv/bin/python evaluate.py --embedder build/face_embedder_v1_fp32.tflite
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
MODELS = HERE / "spike/models"
SFACE_ONNX = MODELS / "face_recognition_sface_2021dec.onnx"
YUNET_ONNX = MODELS / "face_detection_yunet_2023mar.onnx"


def log(msg: str) -> None:
    print(f"[evaluate] {msg}", flush=True)


class TflitePipeline:
    """YuNet detect -> SFace alignCrop -> tflite embed."""

    def __init__(self, embedder_path: Path, norm: str = "raw"):
        self.norm = norm
        self.detector = cv2.FaceDetectorYN.create(str(YUNET_ONNX), "", (0, 0),
                                                  score_threshold=0.6)
        # Used only for its landmark-based alignCrop, not its inference.
        self.aligner = cv2.FaceRecognizerSF.create(str(SFACE_ONNX), "")
        import tensorflow as tf

        self.interp = tf.lite.Interpreter(model_path=str(embedder_path))
        self.interp.allocate_tensors()
        self.inp = self.interp.get_input_details()[0]
        self.out = self.interp.get_output_details()[0]

    def embed(self, bgr: np.ndarray) -> np.ndarray | None:
        """Returns an L2-normalized embedding, or None if no face detected."""
        self.detector.setInputSize((bgr.shape[1], bgr.shape[0]))
        _, faces = self.detector.detect(bgr)
        if faces is None or len(faces) == 0:
            return None
        face = faces[np.argmax(faces[:, -1])]  # highest detection score
        crop = self.aligner.alignCrop(bgr, face)  # 112x112x3 uint8 BGR
        if self.norm == "opencv":
            # Control path: OpenCV's own SFace inference (reference impl).
            emb = self.aligner.feature(crop)[0].astype(np.float64)
            return emb / np.linalg.norm(emb)
        x = crop[np.newaxis].astype(np.float32)  # NHWC
        if self.norm == "arcface":
            x = (x - 127.5) / 128.0
        self.interp.set_tensor(self.inp["index"], x)
        self.interp.invoke()
        emb = self.interp.get_tensor(self.out["index"])[0].astype(np.float64)
        return emb / np.linalg.norm(emb)


LFW_PARQUET_URL = ("https://huggingface.co/datasets/logasja/lfw/resolve/main/"
                   "pairs/{subset}-00000-of-00001.parquet")


def load_pairs(subset: str):
    """Yields (bgr_img_0, bgr_img_1, label) tuples; label 1 = same person."""
    import urllib.request

    import pandas as pd

    cache = HERE / "build/datasets" / f"lfw-pairs-{subset}.parquet"
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        url = LFW_PARQUET_URL.format(subset=subset)
        log(f"downloading {url} -> {cache}")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as r:
            cache.write_bytes(r.read())
    df = pd.read_parquet(cache)
    # The parquet is ordered (all same-person pairs first); shuffle
    # deterministically so --limit N still sees both classes.
    df = df.sample(frac=1, random_state=0).reset_index(drop=True)
    log(f"loaded {len(df)} pairs from {cache.name}")
    for _, row in df.iterrows():
        imgs = [
            cv2.imdecode(np.frombuffer(row[c]["bytes"], np.uint8), cv2.IMREAD_COLOR)
            for c in ("img_0", "img_1")
        ]
        yield imgs[0], imgs[1], int(row["pair"])


def far_frr(same: np.ndarray, diff: np.ndarray, threshold: float):
    far = float(np.mean(diff >= threshold))
    frr = float(np.mean(same < threshold))
    return far, frr


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--embedder", type=Path,
                        default=HERE / "build/face_embedder_v1_int8.tflite")
    parser.add_argument("--subset", choices=["test", "train"], default="test")
    parser.add_argument("--far-target", type=float, default=0.001,
                        help="target false-accept rate (plan 1.2: 0.001)")
    parser.add_argument("--limit", type=int, default=0,
                        help="only evaluate the first N pairs (0 = all)")
    parser.add_argument("--norm", choices=["raw", "arcface", "opencv"], default="raw",
                        help="raw 0..255, (x-127.5)/128, or OpenCV reference "
                             "inference as a control")
    args = parser.parse_args()

    for f in (args.embedder, SFACE_ONNX, YUNET_ONNX):
        if not Path(f).exists():
            log(f"missing {f} — run ./download-models.sh and convert.py first")
            return 1

    pipeline = TflitePipeline(args.embedder, norm=args.norm)

    sims, labels, skipped = [], [], 0
    for i, (img_a, img_b, label) in enumerate(load_pairs(args.subset)):
        if args.limit and i >= args.limit:
            break
        embs = [pipeline.embed(img_a), pipeline.embed(img_b)]
        if embs[0] is None or embs[1] is None:
            skipped += 1
            continue
        sims.append(float(np.dot(embs[0], embs[1])))
        labels.append(label)
        if (i + 1) % 200 == 0:
            log(f"{i + 1} pairs done ({skipped} skipped)")

    sims = np.array(sims)
    labels = np.array(labels)
    same, diff = sims[labels == 1], sims[labels == 0]
    log(f"evaluated {len(sims)} pairs ({skipped} skipped: no face detected)")
    log(f"same-pair cosine mean {same.mean():.3f}, diff-pair mean {diff.mean():.3f}")

    # Threshold sweep.
    thresholds = np.linspace(-0.2, 1.0, 1201)
    fars, frrs = zip(*(far_frr(same, diff, t) for t in thresholds))
    fars, frrs = np.array(fars), np.array(frrs)

    eer_idx = int(np.argmin(np.abs(fars - frrs)))
    # Smallest threshold whose FAR meets the target (maximizes convenience).
    meets = np.where(fars <= args.far_target)[0]
    rec_idx = int(meets[0]) if len(meets) else eer_idx

    report = {
        "embedder": args.embedder.name,
        "subset": args.subset,
        "pairs_evaluated": int(len(sims)),
        "pairs_skipped_no_face": int(skipped),
        "eer": {"threshold": round(float(thresholds[eer_idx]), 4),
                "far": round(float(fars[eer_idx]), 5),
                "frr": round(float(frrs[eer_idx]), 5)},
        "recommended": {
            "face_match_threshold": round(float(thresholds[rec_idx]), 4),
            "far": round(float(fars[rec_idx]), 5),
            "frr": round(float(frrs[rec_idx]), 5),
            "far_target": args.far_target,
        },
        "operating_points": [
            {"threshold": round(float(t), 3),
             "far": round(float(f), 5), "frr": round(float(r), 5)}
            for t, f, r in zip(thresholds[::50], fars[::50], frrs[::50])
        ],
    }
    out = HERE / "build/eval_report.json"
    out.write_text(json.dumps(report, indent=2))
    log(f"EER {report['eer']['far']:.3%} at threshold {report['eer']['threshold']}")
    log(f"recommended face_match_threshold={report['recommended']['face_match_threshold']} "
        f"-> FAR {report['recommended']['far']:.3%}, FRR {report['recommended']['frr']:.3%}")
    log(f"report -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
