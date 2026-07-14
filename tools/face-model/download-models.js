#!/usr/bin/env node
/**
 * Phase 0: fetch pinned model artifacts for the LiteRT.js spike.
 * Downloads into tools/face-model/spike/models/ and verifies SHA-256 sums.
 * Artifacts are NOT checked into git (see .gitignore); re-run this script to fetch.
 *
 * Every artifact is pinned AND content-verified. The OpenCV Zoo files are pinned
 * to an immutable commit SHA (not the moving `main` branch) and the MediaPipe
 * files to versioned URLs, so a re-run always reproduces the same bytes. The
 * shared `fetchVerified` helper verifies the SHA-256 on EVERY run — even when
 * the file already exists — so a drifted, truncated, or re-serialized local
 * copy is caught instead of silently reused. A mismatch after re-download is a
 * hard error — these weights end up gating a physical door lock, so a
 * corrupted or substituted artifact must never be silently accepted.
 *
 * Node-native (fs/crypto/https only) so this runs identically on macOS,
 * Linux, and Windows — no bash, no sha256sum/shasum/curl dependency.
 * Run with: node tools/face-model/download-models.js
 */
const fs = require('fs');
const path = require('path');
const { fetchVerified } = require('./lib/fetchVerify');

const MODELS_DIR = path.join(__dirname, 'spike', 'models');

// Immutable pin for OpenCV Zoo LFS artifacts. `main` is a moving branch: pinning
// to it made the fetched bytes non-reproducible (the original cause of the SFace
// checkpoint drifting to a re-serialized copy). Bump this SHA deliberately, and
// update the expected sums below, when intentionally taking new model revisions.
const ZOO_REF = '47534e27c9851bb1128ccc0102f1145e27f23f98';

// MediaPipe BlazeFace short-range face detector (Apache-2.0), pinned version 1.
// Used directly in production per plan Section 1.1 — this exact artifact ships.
const DETECTOR_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const DETECTOR_SHA = 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f';

// MediaPipe MobileNetV3-small image embedder (Apache-2.0), pinned version 1.
// NOT the production embedder — a same-size-class .tflite proxy so Phase 0 can
// measure embedder-shaped inference latency before the SFace conversion (Phase 1).
const PROXY_EMBEDDER_URL =
  'https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite';
const PROXY_EMBEDDER_SHA = 'bbbb4c51a55a53905af1daec995ca1aae355046f8839bb8c9f5ce9271394bc40';

// SFace ONNX checkpoint (Apache-2.0, OpenCV Zoo) — the picked Phase 0 embedding
// checkpoint. Converted to .tflite in Phase 1; pinned and hashed here.
const SFACE_URL = `https://media.githubusercontent.com/media/opencv/opencv_zoo/${ZOO_REF}/models/face_recognition_sface/face_recognition_sface_2021dec.onnx`;
const SFACE_SHA = '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79';

// YuNet face detector (MIT, OpenCV Zoo) — used only by the offline evaluation
// harness (evaluate.py) for detection + SFace alignCrop. Not shipped to browser.
const YUNET_URL = `https://media.githubusercontent.com/media/opencv/opencv_zoo/${ZOO_REF}/models/face_detection_yunet/face_detection_yunet_2023mar.onnx`;
const YUNET_SHA = '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4';

async function main() {
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  const artifacts = [
    [DETECTOR_URL, 'blaze_face_short_range.tflite', DETECTOR_SHA],
    [PROXY_EMBEDDER_URL, 'mobilenet_v3_small.tflite', PROXY_EMBEDDER_SHA],
    [SFACE_URL, 'face_recognition_sface_2021dec.onnx', SFACE_SHA],
    [YUNET_URL, 'face_detection_yunet_2023mar.onnx', YUNET_SHA],
  ];

  for (const [url, filename, sha] of artifacts) {
    await fetchVerified(url, path.join(MODELS_DIR, filename), sha, { retries: 3 });
  }

  console.log('\nAll artifacts present and SHA-256 verified.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
