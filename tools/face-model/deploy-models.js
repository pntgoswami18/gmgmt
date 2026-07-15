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
 *
 * Also exported as `deploy()`/`checkPrerequisites()` for reuse by
 * `predeploy-models.js`, the soft, non-fatal wrapper `npm start`/`npm run dev`
 * invoke automatically (see package.json's `prestart`/`predev`) — that wrapper
 * needs to distinguish "prerequisites aren't built yet" (quietly skip, don't
 * block a normal boot) from "deploy attempted and failed" (warn, still don't
 * block). `checkPrerequisites()` never throws; `deploy()` throws on both a
 * missing prerequisite and a mid-deploy failure, exactly what the CLI path
 * below needs for its existing die()-on-any-error behavior.
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

/**
 * Returns { ready: true } if every input `deploy()` needs is present, or
 * { ready: false, missing: [...] } listing what's absent. Never throws —
 * safe to call from a startup hook that must not crash the server.
 */
function checkPrerequisites() {
  const missing = [];
  if (!fs.existsSync(EMBEDDER)) missing.push(EMBEDDER);
  if (!fs.existsSync(LITERT_WASM_SRC)) missing.push(LITERT_WASM_SRC);
  if (!fs.existsSync(MEDIAPIPE_WASM_SRC)) missing.push(MEDIAPIPE_WASM_SRC);
  return missing.length === 0 ? { ready: true } : { ready: false, missing };
}

async function deploy() {
  const prereqs = checkPrerequisites();
  if (!prereqs.ready) {
    throw new Error(
      `missing ${prereqs.missing[0]} — run convert.py and 'npm install' in client/ first`
    );
  }

  fs.mkdirSync(OUT, { recursive: true });

  // Embedder (fp32 — exact-fidelity conversion, works on both WASM and WebGPU)
  const embedderOut = path.join(OUT, 'face_embedder_v1_fp32.tflite');
  fs.copyFileSync(EMBEDDER, embedderOut);
  log(`embedder -> ${embedderOut}`);

  // MediaPipe Face Landmarker (pinned)
  const landmarkerOut = path.join(OUT, 'face_landmarker.task');
  await fetchVerified(LANDMARKER_URL, landmarkerOut, LANDMARKER_SHA256);
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

module.exports = { deploy, checkPrerequisites };

if (require.main === module) {
  deploy().catch((err) => die(err.stack || err.message));
}
