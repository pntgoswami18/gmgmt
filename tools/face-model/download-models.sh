#!/usr/bin/env bash
# Phase 0: fetch pinned model artifacts for the LiteRT.js spike.
# Downloads into tools/face-model/spike/models/ and verifies each against its
# expected SHA-256 below. A mismatch is a hard failure — these weights end up
# gating a physical door lock, so a corrupted or substituted artifact must never
# be silently accepted.
# Artifacts are NOT checked into git (see .gitignore); re-run this script to fetch.
set -euo pipefail

MODELS_DIR="$(dirname "$0")/spike/models"
mkdir -p "$MODELS_DIR"
cd "$MODELS_DIR"

# MediaPipe BlazeFace short-range face detector (Apache-2.0), pinned version 1.
# Used directly in production per plan Section 1.1 — this exact artifact ships.
DETECTOR_URL="https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
DETECTOR_SHA="b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f"

# MediaPipe MobileNetV3-small image embedder (Apache-2.0), pinned version 1.
# NOT the production embedder — a same-size-class .tflite proxy so Phase 0 can
# measure embedder-shaped inference latency before the SFace conversion (Phase 1).
PROXY_EMBEDDER_URL="https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite"
PROXY_EMBEDDER_SHA="bbbb4c51a55a53905af1daec995ca1aae355046f8839bb8c9f5ce9271394bc40"

# SFace ONNX checkpoint (Apache-2.0, OpenCV Zoo) — the picked Phase 0 embedding
# checkpoint. Converted to .tflite in Phase 1; downloaded here to pin and hash it.
# Pinned to the commit tagged 4.10.0, not `main`: `main` is a moving branch, and
# this is the artifact that becomes the production embedder.
SFACE_REF="f88e9b2bafd21f1cad242fb5af6d78f2bcba16a3"
SFACE_URL="https://media.githubusercontent.com/media/opencv/opencv_zoo/${SFACE_REF}/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
SFACE_SHA="0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"

# `shasum` on macOS, `sha256sum` on most Linux distros.
if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  echo "error: neither sha256sum nor shasum found" >&2
  exit 1
fi

# Verifies on every run, including when the file was already present — a
# truncated download from a previous run would otherwise never be re-checked.
fetch() {
  local url="$1" out="$2" want="$3" got

  if [ -f "$out" ]; then
    echo "exists: $out"
  else
    echo "fetching: $out"
    curl -fL --retry 3 -o "$out" "$url"
  fi

  got="$(sha256_of "$out")"
  if [ "$got" != "$want" ]; then
    echo >&2
    echo "error: SHA-256 mismatch for $out" >&2
    echo "  expected: $want" >&2
    echo "  actual:   $got" >&2
    echo "Refusing to continue. Delete the file to re-download, or update the" >&2
    echo "expected digest here and in README.md if the upstream artifact moved." >&2
    exit 1
  fi
  echo "  verified: $got"
}

fetch "$DETECTOR_URL"       "blaze_face_short_range.tflite"       "$DETECTOR_SHA"
fetch "$PROXY_EMBEDDER_URL" "mobilenet_v3_small.tflite"           "$PROXY_EMBEDDER_SHA"
fetch "$SFACE_URL"          "face_recognition_sface_2021dec.onnx" "$SFACE_SHA"

echo
echo "All 3 artifacts verified against their pinned SHA-256 digests."
