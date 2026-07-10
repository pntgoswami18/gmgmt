#!/usr/bin/env bash
# Phase 0: fetch pinned model artifacts for the LiteRT.js spike.
# Downloads into tools/face-model/spike/models/ and prints SHA-256 sums.
# Artifacts are NOT checked into git (see .gitignore); re-run this script to fetch.
set -euo pipefail

cd "$(dirname "$0")/spike/models"

# MediaPipe BlazeFace short-range face detector (Apache-2.0), pinned version 1.
# Used directly in production per plan Section 1.1 — this exact artifact ships.
DETECTOR_URL="https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"

# MediaPipe MobileNetV3-small image embedder (Apache-2.0), pinned version 1.
# NOT the production embedder — a same-size-class .tflite proxy so Phase 0 can
# measure embedder-shaped inference latency before the SFace conversion (Phase 1).
PROXY_EMBEDDER_URL="https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite"

# SFace ONNX checkpoint (Apache-2.0, OpenCV Zoo) — the picked Phase 0 embedding
# checkpoint. Converted to .tflite in Phase 1; downloaded here to pin and hash it.
SFACE_URL="https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"

fetch() {
  local url="$1" out="$2"
  if [ -f "$out" ]; then
    echo "exists: $out (skipping)"
  else
    echo "fetching: $out"
    curl -fL --retry 3 -o "$out" "$url"
  fi
}

fetch "$DETECTOR_URL"       "blaze_face_short_range.tflite"
fetch "$PROXY_EMBEDDER_URL" "mobilenet_v3_small.tflite"
fetch "$SFACE_URL"          "face_recognition_sface_2021dec.onnx"

echo
echo "SHA-256 sums (record in README.md if they change):"
shasum -a 256 blaze_face_short_range.tflite mobilenet_v3_small.tflite face_recognition_sface_2021dec.onnx
