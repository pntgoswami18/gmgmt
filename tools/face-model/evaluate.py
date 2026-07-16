#!/usr/bin/env python3
"""Phase 1: offline model-quality harness (plan Sections 1.3 / 8.1).

Runs the LFW pairs protocol against the converted embedder:

  LFW pair -> YuNet detect (per image) -> SFace alignCrop (OpenCV, landmark
  alignment) -> embed via .tflite -> cosine similarity

and reports ROC / FAR-FRR, EER, and a recommended VERIFICATION threshold at
the target FAR from plan Section 1.2 (balanced: FAR ~0.1%).

IMPORTANT — this is a 1:1 *verification* threshold, not the production 1:N
*identification* accept threshold. LFW pairs ask "are these two the same
person?" (one comparison). The check-in flow takes the top-1 match across the
whole gallery, so an impostor gets one shot per enrolled member and the
per-encounter false-accept rate compounds with gallery size. The number this
harness prints must be re-derived against the gym's own gallery (plan
Sections 1.2 / 8.3) before it becomes `face_match_threshold`.

FAR resolution: with N negative pairs the smallest non-zero FAR measurable is
1/N. A reported FAR of 0 means "no false accepts in N trials" — an upper
bound (~3/N by the rule of three), not a measurement of 0. The report carries
raw false-accept counts, denominators, and a 95% CI so this isn't mistaken
for a resolved low FAR. To actually resolve a 0.1% FAR you need O(1e4-1e5)
negatives; 1100 cannot.

Alignment note: this harness aligns with OpenCV's YuNet+SFace alignCrop —
the browser pipeline will align with MediaPipe landmarks. Small skew is
expected; shadow mode (plan Section 8.3) is the real-world validation.

Dataset: LFW pairs parquet mirrored on Hugging Face (logasja/lfw; original
figshare/UMass hosts used by scikit-learn's fetch_lfw_pairs are dead — 403 /
NXDOMAIN as of 2026-07). Pinned to a specific revision and verified by
SHA-256 — this dataset gates a physical lock's threshold, so it gets the same
integrity treatment as download-models.sh. ~58 MB per split, cached
atomically in build/datasets/. 2200 pairs per split (1100 same + 1100 diff).

Usage:
  .venv/bin/python evaluate.py                       # fp32 tflite, test split
  .venv/bin/python evaluate.py --subset train        # other split
  .venv/bin/python evaluate.py --embedder build/face_embedder_v1_int8.tflite
"""

import argparse
import hashlib
import json
import math
import os
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


# Pinned to an immutable revision (not `main`, which moves) and verified by
# SHA-256. Update all three together if the dataset is intentionally bumped.
LFW_REVISION = "0ee47979927a48dadf11083cb53b51439fa92dc9"
LFW_PARQUET_URL = ("https://huggingface.co/datasets/logasja/lfw/resolve/"
                   "{revision}/pairs/{subset}-00000-of-00001.parquet")
LFW_SHA256 = {
    "test": "a56fda63b446976abc20a68d56c70c4e53b1ac1f813fe33092ba2c18749d30a8",
    "train": "d9333c3b69777d11f93421bfbed6c208bdbda68b129de8e8693f3d1918bca133",
}


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_pairs(subset: str):
    """Yields (bgr_img_0, bgr_img_1, label) tuples; label 1 = same person."""
    import urllib.request

    import pandas as pd

    expected = LFW_SHA256[subset]
    cache = HERE / "build/datasets" / f"lfw-pairs-{subset}.parquet"
    # Re-download if missing OR if a cached copy fails the checksum (guards
    # against a truncated/corrupt earlier download being silently reused).
    if not cache.exists() or _sha256(cache) != expected:
        cache.parent.mkdir(parents=True, exist_ok=True)
        url = LFW_PARQUET_URL.format(revision=LFW_REVISION, subset=subset)
        log(f"downloading {url} -> {cache}")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        tmp = cache.with_suffix(cache.suffix + ".part")
        with urllib.request.urlopen(req) as r:
            tmp.write_bytes(r.read())
        got = _sha256(tmp)
        if got != expected:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(
                f"LFW {subset} checksum mismatch: expected {expected}, got "
                f"{got}. Revision {LFW_REVISION} may have moved or the "
                "download is corrupt — refusing to evaluate a lock threshold "
                "against unverified data.")
        os.replace(tmp, cache)  # atomic: no partial file is ever named .parquet
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


def wilson_interval(k: int, n: int, z: float = 1.96):
    """95% Wilson score interval for a binomial proportion k/n.

    Dependency-free (no scipy). Well-behaved at k=0 and k=n, where the normal
    approximation degenerates. Used to report how uncertain a FAR/FRR really
    is given the sample size — a point estimate of 0 out of 1100 is not 0.
    """
    if n == 0:
        return 0.0, 1.0
    phat = k / n
    denom = 1 + z * z / n
    center = (phat + z * z / (2 * n)) / denom
    half = (z / denom) * math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n))
    return max(0.0, center - half), min(1.0, center + half)


def far_point(diff: np.ndarray, threshold: float):
    """(false_accepts, negatives, point_estimate) at a threshold."""
    k = int(np.sum(diff >= threshold))
    n = int(len(diff))
    return k, n, (k / n if n else 0.0)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--embedder", type=Path,
                        default=HERE / "build/face_embedder_v1_fp32.tflite")
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
    if len(same) == 0 or len(diff) == 0:
        log(f"insufficient data: {len(same)} same-pairs, {len(diff)} diff-pairs "
            f"({skipped} skipped) — cannot compute FAR/FRR. Aborting.")
        return 1
    log(f"evaluated {len(sims)} pairs ({skipped} skipped: no face detected)")
    log(f"same-pair cosine mean {same.mean():.3f}, diff-pair mean {diff.mean():.3f}")

    # FAR resolution: with N negatives the smallest non-zero FAR is 1/N, and a
    # target below the rule-of-three bound (~3/N) cannot be resolved at all —
    # zero observed false accepts only bounds the true FAR, it doesn't measure
    # it. Warn loudly rather than presenting an unresolvable target as "met".
    n_neg = len(diff)
    far_resolution = 1.0 / n_neg
    rule_of_three = 3.0 / n_neg
    far_target_resolvable = args.far_target >= rule_of_three
    if not far_target_resolvable:
        log(f"WARNING: far_target={args.far_target:.4%} is below this sample's "
            f"resolution — {n_neg} negatives can only bound FAR to ~{rule_of_three:.3%} "
            "(rule of three). The recommended threshold's FAR is an UPPER BOUND, "
            "not a measurement. Use O(1e4-1e5) negatives to resolve a 0.1% FAR.")

    # Threshold sweep.
    thresholds = np.linspace(-0.2, 1.0, 1201)
    fars, frrs = zip(*(far_frr(same, diff, t) for t in thresholds))
    fars, frrs = np.array(fars), np.array(frrs)

    eer_idx = int(np.argmin(np.abs(fars - frrs)))
    # Smallest threshold whose FAR meets the target (maximizes convenience).
    meets = np.where(fars <= args.far_target)[0]
    if len(meets):
        rec_idx = int(meets[0])
        fell_back = False
    else:
        # No operating point meets the target FAR — fall back to EER, but say
        # so: EER is a far more permissive threshold and silently returning it
        # under the same field name would understate the real FAR.
        rec_idx = eer_idx
        fell_back = True
        log(f"WARNING: no threshold meets far_target={args.far_target:.4%}; "
            f"falling back to the EER threshold {float(thresholds[eer_idx]):.4f} "
            f"(FAR {float(fars[eer_idx]):.3%}) — this is NOT at the requested FAR.")

    def point(idx: int):
        t = float(thresholds[idx])
        k, n, far = far_point(diff, t)
        far_lo, far_hi = wilson_interval(k, n)
        frr_k = int(np.sum(same < t))
        frr_lo, frr_hi = wilson_interval(frr_k, len(same))
        return {
            "threshold": round(t, 4),
            "far": round(far, 5),
            "far_false_accepts": k,
            "far_negatives": n,
            "far_95ci": [round(far_lo, 5), round(far_hi, 5)],
            "frr": round(float(frrs[idx]), 5),
            "frr_false_rejects": frr_k,
            "frr_positives": int(len(same)),
            "frr_95ci": [round(frr_lo, 5), round(frr_hi, 5)],
        }

    recommended = point(rec_idx)
    recommended.update({
        "far_target": args.far_target,
        "far_target_resolvable": far_target_resolvable,
        "fell_back_to_eer": fell_back,
        "protocol": "1:1 verification (LFW pairs)",
        "note": ("Verification threshold, NOT the 1:N identification accept "
                 "threshold. Re-derive against the gallery before adopting as "
                 "face_match_threshold (plan 1.2 / 8.3)."),
    })

    report = {
        "embedder": args.embedder.name,
        "subset": args.subset,
        "pairs_evaluated": int(len(sims)),
        "pairs_skipped_no_face": int(skipped),
        "far_resolution": round(far_resolution, 6),
        "eer": point(eer_idx),
        "recommended": recommended,
        "operating_points": [
            {"threshold": round(float(t), 3),
             "far": round(float(f), 5), "frr": round(float(r), 5)}
            for t, f, r in zip(thresholds[::50], fars[::50], frrs[::50])
        ],
    }
    out = HERE / "build/eval_report.json"
    out.write_text(json.dumps(report, indent=2))
    log(f"EER {report['eer']['far']:.3%} at threshold {report['eer']['threshold']}")
    rec = report["recommended"]
    log(f"recommended verification threshold={rec['threshold']} -> "
        f"FAR {rec['far']:.3%} (95% CI {rec['far_95ci'][0]:.3%}–{rec['far_95ci'][1]:.3%}, "
        f"{rec['far_false_accepts']}/{rec['far_negatives']}), FRR {rec['frr']:.3%}")
    log("  NOTE: 1:1 verification threshold — not the 1:N accept threshold; "
        "re-derive against the gallery (plan 8.3).")
    log(f"report -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
