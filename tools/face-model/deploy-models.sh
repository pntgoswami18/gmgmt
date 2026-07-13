#!/usr/bin/env bash
# Phase 3: deploy the face models + runtime assets into public/models so the
# backend can serve them to the enrollment/check-in clients (plan Sections
# 1.4, 2.3). Everything is served from localhost — no CDN at runtime.
#
# Inputs:
#   - build/face_embedder_v1_fp32.tflite   (produced by convert.py; fp32 is
#     the v1 recommendation from the Phase 1 benchmark — see README)
#   - MediaPipe face_landmarker.task       (downloaded, pinned by sha256)
#   - client/node_modules/@litertjs/core/wasm         (LiteRT runtime)
#   - client/node_modules/@mediapipe/tasks-vision/wasm (landmarker runtime)
#
# Output: public/models/… + manifest.json (served by GET /api/biometric/face/model-manifest)
#
# public/models is git-ignored (like public/uploads) — run this script on each
# deployment, after `convert.py` and `cd client && npm install`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$REPO_ROOT/public/models"

EMBEDDER="$HERE/build/face_embedder_v1_fp32.tflite"
MODEL_VERSION="sface_2021dec_fp32_v1"

LANDMARKER_URL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
LANDMARKER_SHA256="64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"

LITERT_WASM_SRC="$REPO_ROOT/client/node_modules/@litertjs/core/wasm"
MEDIAPIPE_WASM_SRC="$REPO_ROOT/client/node_modules/@mediapipe/tasks-vision/wasm"

log() { echo "[deploy-models] $*"; }

# `shasum` on macOS, `sha256sum` on most Linux distros.
if command -v sha256sum >/dev/null 2>&1; then
  sha_of() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  echo "[deploy-models] error: neither sha256sum nor shasum found" >&2
  exit 1
fi

verify_sha() { # file expected_sha
  local actual
  actual="$(sha_of "$1")"
  if [[ "$actual" != "$2" ]]; then
    echo "[deploy-models] CHECKSUM MISMATCH for $1" >&2
    echo "  expected: $2" >&2
    echo "  actual:   $actual" >&2
    exit 1
  fi
}

[[ -f "$EMBEDDER" ]] || {
  echo "[deploy-models] missing $EMBEDDER — run convert.py first" >&2
  exit 1
}
[[ -d "$LITERT_WASM_SRC" ]] || {
  echo "[deploy-models] missing $LITERT_WASM_SRC — run 'npm install' in client/ first" >&2
  exit 1
}
[[ -d "$MEDIAPIPE_WASM_SRC" ]] || {
  echo "[deploy-models] missing $MEDIAPIPE_WASM_SRC — run 'npm install' in client/ first" >&2
  exit 1
}

mkdir -p "$OUT"

# Embedder (fp32 — exact-fidelity conversion, works on both WASM and WebGPU)
cp "$EMBEDDER" "$OUT/face_embedder_v1_fp32.tflite"
log "embedder -> $OUT/face_embedder_v1_fp32.tflite"

# MediaPipe Face Landmarker (pinned)
if [[ ! -f "$OUT/face_landmarker.task" ]]; then
  log "downloading face_landmarker.task…"
  curl -fsSL -o "$OUT/face_landmarker.task.tmp" "$LANDMARKER_URL"
  verify_sha "$OUT/face_landmarker.task.tmp" "$LANDMARKER_SHA256"
  mv "$OUT/face_landmarker.task.tmp" "$OUT/face_landmarker.task"
else
  verify_sha "$OUT/face_landmarker.task" "$LANDMARKER_SHA256"
fi
log "landmarker -> $OUT/face_landmarker.task (sha256 verified)"

# Runtime wasm bundles, served same-origin (no CDN at runtime)
rm -rf "$OUT/litert-wasm" "$OUT/mediapipe-wasm"
cp -R "$LITERT_WASM_SRC" "$OUT/litert-wasm"
cp -R "$MEDIAPIPE_WASM_SRC" "$OUT/mediapipe-wasm"
log "wasm runtimes -> $OUT/{litert-wasm,mediapipe-wasm}"

EMBEDDER_SHA="$(sha_of "$OUT/face_embedder_v1_fp32.tflite")"

cat > "$OUT/manifest.json" <<EOF
{
  "modelVersion": "$MODEL_VERSION",
  "embedder": {
    "url": "/models/face_embedder_v1_fp32.tflite",
    "sha256": "$EMBEDDER_SHA",
    "inputSize": 112,
    "embeddingDim": 128,
    "input": "NHWC float32, BGR channel order, raw 0-255 (normalization is baked into the graph)"
  },
  "landmarker": {
    "url": "/models/face_landmarker.task",
    "sha256": "$LANDMARKER_SHA256"
  },
  "litertWasmPath": "/models/litert-wasm/",
  "mediapipeWasmPath": "/models/mediapipe-wasm/",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
log "manifest -> $OUT/manifest.json (modelVersion=$MODEL_VERSION)"
log "done — GET /api/biometric/face/model-manifest will now serve this deployment"
