const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Exercises tools/face-model/deploy-models.js's deploy() embedder fallback:
// prefer a local build/ output (maintainer's convert.py run) and only fall
// back to fetching+sha256-verifying the pinned GitHub Release asset
// (EMBEDDER_URL/EMBEDDER_SHA256) when build/ is absent. Real fs writes and
// real network fetches are stubbed out — this only asserts which branch
// deploy() takes and what it hands to fs/fetchVerify, not the plumbing
// those helpers already have their own coverage for.

const deployModelsPath = require.resolve('../../../tools/face-model/deploy-models');
const fetchVerifyPath = require.resolve('../../../tools/face-model/lib/fetchVerify');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const EMBEDDER_LOCAL = path.join(
  REPO_ROOT,
  'tools',
  'face-model',
  'build',
  'face_embedder_v1_fp32.tflite'
);
const LITERT_WASM_SRC = path.join(REPO_ROOT, 'client', 'node_modules', '@litertjs', 'core', 'wasm');
const MEDIAPIPE_WASM_SRC = path.join(
  REPO_ROOT,
  'client',
  'node_modules',
  '@mediapipe',
  'tasks-vision',
  'wasm'
);

/**
 * Runs `fn(deployModels)` with fs write/read side effects and lib/fetchVerify
 * stubbed out, and with fs.existsSync answering only for the paths this test
 * cares about (embedder local build presence) while reporting the wasm
 * runtime prerequisite paths as present so checkPrerequisites() stays ready
 * regardless of what's actually installed in this checkout.
 */
async function withStubbedDeploy({ embedderLocalExists, fetchVerified }, fn) {
  const originalFetchVerifyCache = require.cache[fetchVerifyPath];
  const fetchVerifiedCalls = [];
  require.cache[fetchVerifyPath] = {
    id: fetchVerifyPath,
    filename: fetchVerifyPath,
    loaded: true,
    exports: {
      sha256File: () => '0'.repeat(64),
      verifySha: () => {},
      downloadFile: async () => {},
      fetchVerified: async (url, outPath, sha) => {
        fetchVerifiedCalls.push({ url, outPath, sha });
        if (fetchVerified) await fetchVerified(url, outPath, sha);
      },
    },
  };
  delete require.cache[deployModelsPath];

  const originalExistsSync = fs.existsSync;
  const originalMkdirSync = fs.mkdirSync;
  const originalCopyFileSync = fs.copyFileSync;
  const originalRmSync = fs.rmSync;
  const originalCpSync = fs.cpSync;
  const originalWriteFileSync = fs.writeFileSync;
  const copyFileSyncCalls = [];

  fs.existsSync = (p) => {
    if (p === EMBEDDER_LOCAL) return embedderLocalExists;
    if (p === LITERT_WASM_SRC || p === MEDIAPIPE_WASM_SRC) return true;
    return originalExistsSync(p);
  };
  fs.mkdirSync = () => {};
  fs.copyFileSync = (src, dest) => {
    copyFileSyncCalls.push({ src, dest });
  };
  fs.rmSync = () => {};
  fs.cpSync = () => {};
  fs.writeFileSync = () => {};

  try {
    const deployModels = require('../../../tools/face-model/deploy-models');
    await fn(deployModels, { fetchVerifiedCalls, copyFileSyncCalls });
  } finally {
    fs.existsSync = originalExistsSync;
    fs.mkdirSync = originalMkdirSync;
    fs.copyFileSync = originalCopyFileSync;
    fs.rmSync = originalRmSync;
    fs.cpSync = originalCpSync;
    fs.writeFileSync = originalWriteFileSync;
    if (originalFetchVerifyCache) {
      require.cache[fetchVerifyPath] = originalFetchVerifyCache;
    } else {
      delete require.cache[fetchVerifyPath];
    }
    delete require.cache[deployModelsPath];
  }
}

test('deploy() copies the local build/ embedder and does not fetch it remotely when present', async () => {
  await withStubbedDeploy({ embedderLocalExists: true }, async (deployModels, calls) => {
    await deployModels.deploy();

    assert.equal(calls.copyFileSyncCalls.length, 1);
    assert.equal(calls.copyFileSyncCalls[0].src, EMBEDDER_LOCAL);

    const embedderFetches = calls.fetchVerifiedCalls.filter((c) =>
      c.outPath.endsWith('face_embedder_v1_fp32.tflite')
    );
    assert.equal(
      embedderFetches.length,
      0,
      'must not fetch the embedder when a local build exists'
    );
  });
});

test('deploy() falls back to fetching+sha256-verifying the pinned release asset when build/ is absent', async () => {
  await withStubbedDeploy({ embedderLocalExists: false }, async (deployModels, calls) => {
    await deployModels.deploy();

    assert.equal(
      calls.copyFileSyncCalls.length,
      0,
      'must not copy a local build that does not exist'
    );

    const embedderFetches = calls.fetchVerifiedCalls.filter((c) =>
      c.outPath.endsWith('face_embedder_v1_fp32.tflite')
    );
    assert.equal(
      embedderFetches.length,
      1,
      'must fetch the embedder from the pinned release asset'
    );
    assert.match(
      embedderFetches[0].url,
      /^https:\/\/github\.com\/.*face_embedder_v1_fp32\.tflite$/
    );
    assert.equal(
      embedderFetches[0].sha,
      'f2fde3b5a49508c1f1d2ff34fb2c612163ec9d945cc0431efbbc9ebbed16ec7b'
    );
  });
});

test('deploy() propagates a checksum mismatch on the downloaded embedder as a rejection', async () => {
  await assert.rejects(
    withStubbedDeploy(
      {
        embedderLocalExists: false,
        fetchVerified: async (url) => {
          if (url.endsWith('face_embedder_v1_fp32.tflite')) {
            throw new Error('CHECKSUM MISMATCH for face_embedder_v1_fp32.tflite');
          }
        },
      },
      async (deployModels) => {
        await deployModels.deploy();
      }
    ),
    /CHECKSUM MISMATCH/
  );
});
