#!/usr/bin/env bash
# Phase 0: fetch pinned model artifacts for the LiteRT.js spike.
# Downloads into tools/face-model/spike/models/ and verifies SHA-256 sums.
# Artifacts are NOT checked into git (see .gitignore); re-run this script to fetch.
#
# Every artifact is pinned AND content-verified. The OpenCV Zoo files are pinned
# to an immutable commit SHA (not the moving `main` branch) and the MediaPipe
# files to versioned URLs, so a re-run always reproduces the same bytes. `fetch`
# verifies the SHA-256 on EVERY run — even when the file already exists — so a
# drifted, truncated, or re-serialized local copy is caught instead of silently
# reused. A mismatch after re-download is a hard error — these weights end up
# gating a physical door lock, so a corrupted or substituted artifact must never
# be silently accepted.
set -euo pipefail

MODELS_DIR="$(dirname "$0")/spike/models"
mkdir -p "$MODELS_DIR"
cd "$MODELS_DIR"

# Immutable pin for OpenCV Zoo LFS artifacts. `main` is a moving branch: pinning
# to it made the fetched bytes non-reproducible (the original cause of the SFace
# checkpoint drifting to a re-serialized copy). Bump this SHA deliberately, and
# update the expected sums below, when intentionally taking new model revisions.
ZOO_REF="47534e27c9851bb1128ccc0102f1145e27f23f98"

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
# checkpoint. Converted to .tflite in Phase 1; pinned and hashed here.
SFACE_URL="https://media.githubusercontent.com/media/opencv/opencv_zoo/${ZOO_REF}/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
SFACE_SHA="0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"

# YuNet face detector (MIT, OpenCV Zoo) — used only by the offline evaluation
# harness (evaluate.py) for detection + SFace alignCrop. Not shipped to browser.
YUNET_URL="https://media.githubusercontent.com/media/opencv/opencv_zoo/${ZOO_REF}/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
YUNET_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"

# `shasum` on macOS, `sha256sum` on most Linux distros.
if command -v sha256sum >/dev/null 2>&1; then
  sha_of() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  echo "error: neither sha256sum nor shasum found" >&2
  exit 1
fi

# fetch <url> <out> <expected-sha256>
# Verifies on every run; (re)downloads on a missing or mismatched file; hard
# errors if the bytes still don't match the pin after a fresh download.
fetch() {
  local url="$1" out="$2" want="$3" got=""
  if [ -f "$out" ]; then
    got="$(sha_of "$out")"
    if [ "$got" = "$want" ]; then
      echo "ok: $out (sha256 verified)"
      return 0
    fi
    echo "stale: $out (sha256 $got != $want) — re-fetching"
    rm -f "$out"
  fi
  echo "fetching: $out"
  curl -fL --retry 3 -o "$out" "$url"
  got="$(sha_of "$out")"
  if [ "$got" != "$want" ]; then
    echo "ERROR: $out sha256 mismatch after download" >&2
    echo "  expected: $want" >&2
    echo "  got:      $got" >&2
    rm -f "$out"
    exit 1
  fi
  echo "ok: $out (sha256 verified)"
}

fetch "$DETECTOR_URL"       "blaze_face_short_range.tflite"        "$DETECTOR_SHA"
fetch "$PROXY_EMBEDDER_URL" "mobilenet_v3_small.tflite"            "$PROXY_EMBEDDER_SHA"
fetch "$SFACE_URL"          "face_recognition_sface_2021dec.onnx"  "$SFACE_SHA"
fetch "$YUNET_URL"          "face_detection_yunet_2023mar.onnx"    "$YUNET_SHA"

echo
echo "All artifacts present and SHA-256 verified."
