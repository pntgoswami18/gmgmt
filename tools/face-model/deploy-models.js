#!/usr/bin/env node
/**
 * Phase 3: deploy the face models + runtime assets into public/models so the
 * backend can serve them to the enrollment/check-in clients (plan Sections
 * 1.4, 2.3). Everything is served from localhost — no CDN at runtime.
 *
 * Inputs:
 *   - build/face_embedder_v1_fp32.tflite   (produced by convert.py; fp32 is
 *     the v1 recommendation from the Phase 1 benchmark — see README)
 *   - MediaPipe face_landmarker.task       (downloaded, pinned by sha256)
 *   - client/node_modules/@litertjs/core/wasm         (LiteRT runtime)
 *   - client/node_modules/@mediapipe/tasks-vision/wasm (landmarker runtime)
 *
 * Output: public/models/… + manifest.json (served by GET /api/biometric/face/model-manifest)
 *
 * public/models is git-ignored (like public/uploads) — run this script on each
 * deployment, after `convert.py` and `cd client && npm install`.
 *
 * Node-native (fs/crypto/https only) so this runs identically on macOS,
 * Linux, and Windows — no bash, no sha256sum/shasum/cp/curl dependency.
 * Run with: node tools/face-model/deploy-models.js
 */
const fs = require('fs');
const path = require('path');
const { sha256File, fetchVerified } = require('./lib/fetchVerify');

const HERE = __dirname;
const REPO_ROOT = path.resolve(HERE, '../..');
const OUT = path.join(REPO_ROOT, 'public', 'models');

const EMBEDDER = path.join(HERE, 'build', 'face_embedder_v1_fp32.tflite');
const MODEL_VERSION = 'sface_2021dec_fp32_v1';

const LANDMARKER_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const LANDMARKER_SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';

const LITERT_WASM_SRC = path.join(REPO_ROOT, 'client', 'node_modules', '@litertjs', 'core', 'wasm');
const MEDIAPIPE_WASM_SRC = path.join(
  REPO_ROOT,
  'client',
  'node_modules',
  '@mediapipe',
  'tasks-vision',
  'wasm'
);

function log(...args) {
  console.log('[deploy-models]', ...args);
}

function die(message) {
  console.error(`[deploy-models] ${message}`);
  process.exit(1);
}

async function main() {
  if (!fs.existsSync(EMBEDDER)) {
    die(`missing ${EMBEDDER} — run convert.py first`);
  }
  if (!fs.existsSync(LITERT_WASM_SRC)) {
    die(`missing ${LITERT_WASM_SRC} — run 'npm install' in client/ first`);
  }
  if (!fs.existsSync(MEDIAPIPE_WASM_SRC)) {
    die(`missing ${MEDIAPIPE_WASM_SRC} — run 'npm install' in client/ first`);
  }

  fs.mkdirSync(OUT, { recursive: true });

  // Embedder (fp32 — exact-fidelity conversion, works on both WASM and WebGPU)
  const embedderOut = path.join(OUT, 'face_embedder_v1_fp32.tflite');
  fs.copyFileSync(EMBEDDER, embedderOut);
  log(`embedder -> ${embedderOut}`);

  // MediaPipe Face Landmarker (pinned)
  const landmarkerOut = path.join(OUT, 'face_landmarker.task');
  try {
    await fetchVerified(LANDMARKER_URL, landmarkerOut, LANDMARKER_SHA256);
  } catch (err) {
    die(err.message);
  }
  log(`landmarker -> ${landmarkerOut} (sha256 verified)`);

  // Runtime wasm bundles, served same-origin (no CDN at runtime)
  const litertOut = path.join(OUT, 'litert-wasm');
  const mediapipeOut = path.join(OUT, 'mediapipe-wasm');
  fs.rmSync(litertOut, { recursive: true, force: true });
  fs.rmSync(mediapipeOut, { recursive: true, force: true });
  fs.cpSync(LITERT_WASM_SRC, litertOut, { recursive: true });
  fs.cpSync(MEDIAPIPE_WASM_SRC, mediapipeOut, { recursive: true });
  log(`wasm runtimes -> ${OUT}/{litert-wasm,mediapipe-wasm}`);

  const embedderSha = sha256File(embedderOut);

  const manifest = {
    modelVersion: MODEL_VERSION,
    embedder: {
      url: '/models/face_embedder_v1_fp32.tflite',
      sha256: embedderSha,
      inputSize: 112,
      embeddingDim: 128,
      input: 'NHWC float32, BGR channel order, raw 0-255 (normalization is baked into the graph)',
    },
    landmarker: {
      url: '/models/face_landmarker.task',
      sha256: LANDMARKER_SHA256,
    },
    litertWasmPath: '/models/litert-wasm/',
    mediapipeWasmPath: '/models/mediapipe-wasm/',
    deployedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const manifestOut = path.join(OUT, 'manifest.json');
  fs.writeFileSync(manifestOut, JSON.stringify(manifest, null, 2) + '\n');
  log(`manifest -> ${manifestOut} (modelVersion=${MODEL_VERSION})`);
  log('done — GET /api/biometric/face/model-manifest will now serve this deployment');
}

main().catch((err) => die(err.stack || err.message));
