#!/usr/bin/env node
/**
 * Phase 3: deploy the face models + runtime assets into public/models so the
 * backend can serve them to the enrollment/check-in clients (plan Sections
 * 1.4, 2.3). Everything is served from localhost — no CDN at runtime.
 *
 * Inputs:
 *   - The embedder, `face_embedder_v1_fp32.tflite`: if `build/` (produced
 *     locally by convert.py) has it, that copy is used as-is — the normal
 *     maintainer iteration loop. Otherwise it's fetched from the pinned
 *     GitHub Release asset below and sha256-verified, so any machine without
 *     a local Python/TensorFlow conversion pipeline (a fresh install, CI, the
 *     installed Windows Service) can still deploy it. Bump EMBEDDER_URL/
 *     EMBEDDER_SHA256 together, deliberately, when publishing a new model
 *     revision (same discipline as ZOO_REF in download-models.js).
 *   - MediaPipe face_landmarker.task       (downloaded, pinned by sha256)
 *   - client/node_modules/@litertjs/core/wasm         (LiteRT runtime)
 *   - client/node_modules/@mediapipe/tasks-vision/wasm (landmarker runtime)
 *
 * Output: public/models/… + manifest.json (served by GET /api/biometric/face/model-manifest)
 *
 * public/models is git-ignored (like public/uploads) — run this script on each
 * deployment, after `cd client && npm install`. A local `convert.py` run is no
 * longer required (see above).
 *
 * Node-native (fs/crypto/https only) so this runs identically on macOS,
 * Linux, and Windows — no bash, no sha256sum/shasum/cp/curl dependency.
 * Run with: node tools/face-model/deploy-models.js
 *
 * Also exported as `deploy()`/`checkPrerequisites()` for reuse by
 * `predeploy-models.js` (the soft, non-fatal wrapper `npm start`/`npm run dev`
 * invoke via `prestart`/`predev`) and by `src/app.js`, which calls the same
 * soft wrapper directly at boot — the installed Windows Service launches
 * `node.exe src/app.js` straight from `scripts/service-install.js`, bypassing
 * npm lifecycle hooks entirely, so `prestart` alone never ran for it. That
 * wrapper needs to distinguish "prerequisites aren't built yet" (quietly
 * skip, don't block a normal boot) from "deploy attempted and failed" (warn,
 * still don't block). `checkPrerequisites()` never throws; `deploy()` throws
 * on both a missing prerequisite and a mid-deploy failure, exactly what the
 * CLI path below needs for its existing die()-on-any-error behavior.
 */
const fs = require('fs');
const path = require('path');
const { sha256File, fetchVerified } = require('./lib/fetchVerify');

const HERE = __dirname;
const REPO_ROOT = path.resolve(HERE, '../..');
const OUT = path.join(REPO_ROOT, 'public', 'models');

const EMBEDDER_LOCAL = path.join(HERE, 'build', 'face_embedder_v1_fp32.tflite');
const EMBEDDER_URL =
  'https://github.com/pntgoswami18/gmgmt/releases/download/face-model-v1/face_embedder_v1_fp32.tflite';
const EMBEDDER_SHA256 = 'f2fde3b5a49508c1f1d2ff34fb2c612163ec9d945cc0431efbbc9ebbed16ec7b';
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
 *
 * The embedder itself is NOT checked here: it either exists locally
 * (build/, from a maintainer's convert.py run) or gets fetched from the
 * pinned release on demand — either way `deploy()` can produce it, so its
 * absence isn't a missing prerequisite the way the wasm runtimes are.
 */
function checkPrerequisites() {
  const missing = [];
  if (!fs.existsSync(LITERT_WASM_SRC)) missing.push(LITERT_WASM_SRC);
  if (!fs.existsSync(MEDIAPIPE_WASM_SRC)) missing.push(MEDIAPIPE_WASM_SRC);
  return missing.length === 0 ? { ready: true } : { ready: false, missing };
}

/**
 * Returns true if public/models already holds a deployment that matches the
 * currently pinned versions/hashes — i.e. a fresh deploy() call would be a
 * no-op. This lets deploy() skip its destructive rm+cp/copy work (and the
 * brief asset-unavailability window that work opens up) on an ordinary
 * restart, instead of unconditionally redoing it every time the process
 * boots. Never throws — a bad/partial manifest just means "not up to date".
 */
function isUpToDate() {
  try {
    const manifestOut = path.join(OUT, 'manifest.json');
    if (!fs.existsSync(manifestOut)) return false;
    const manifest = JSON.parse(fs.readFileSync(manifestOut, 'utf8'));
    if (manifest.modelVersion !== MODEL_VERSION) return false;
    if (!manifest.landmarker || manifest.landmarker.sha256 !== LANDMARKER_SHA256) return false;

    const expectedEmbedderSha = fs.existsSync(EMBEDDER_LOCAL)
      ? sha256File(EMBEDDER_LOCAL)
      : EMBEDDER_SHA256;
    if (!manifest.embedder || manifest.embedder.sha256 !== expectedEmbedderSha) return false;

    const embedderOut = path.join(OUT, 'face_embedder_v1_fp32.tflite');
    if (!fs.existsSync(embedderOut) || sha256File(embedderOut) !== expectedEmbedderSha) {
      return false;
    }

    const landmarkerOut = path.join(OUT, 'face_landmarker.task');
    if (!fs.existsSync(landmarkerOut)) return false;

    const litertOut = path.join(OUT, 'litert-wasm');
    const mediapipeOut = path.join(OUT, 'mediapipe-wasm');
    if (!fs.existsSync(litertOut) || fs.readdirSync(litertOut).length === 0) return false;
    if (!fs.existsSync(mediapipeOut) || fs.readdirSync(mediapipeOut).length === 0) return false;

    return true;
  } catch {
    return false;
  }
}

async function deploy() {
  const prereqs = checkPrerequisites();
  if (!prereqs.ready) {
    throw new Error(`missing ${prereqs.missing[0]} — run 'npm install' in client/ first`);
  }

  if (isUpToDate()) {
    log('public/models already up to date — skipping redeploy');
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });

  // Embedder (fp32 — exact-fidelity conversion, works on both WASM and WebGPU).
  // Prefer a local convert.py build (maintainer iterating on a new revision);
  // otherwise fetch the pinned release asset, sha256-verified.
  const embedderOut = path.join(OUT, 'face_embedder_v1_fp32.tflite');
  if (fs.existsSync(EMBEDDER_LOCAL)) {
    fs.copyFileSync(EMBEDDER_LOCAL, embedderOut);
    log(`embedder -> ${embedderOut} (from local build/)`);
  } else {
    await fetchVerified(EMBEDDER_URL, embedderOut, EMBEDDER_SHA256);
    log(`embedder -> ${embedderOut} (downloaded, sha256 verified)`);
  }

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

module.exports = { deploy, checkPrerequisites, isUpToDate };

if (require.main === module) {
  deploy().catch((err) => die(err.stack || err.message));
}
