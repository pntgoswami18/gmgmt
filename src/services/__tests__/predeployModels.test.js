const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Exercises tools/face-model/predeploy-models.js's runPredeploy() — the soft,
// non-fatal wrapper invoked both by package.json's prestart/predev and by
// src/app.js at boot. Its entire contract is "never throws, never rejects,
// regardless of what deploy-models.js does" — that's what's tested here by
// substituting a fake './deploy-models' via require.cache, the same
// technique src/services/__tests__/deviceDiscoveryService.test.js uses for
// 'bonjour-service'.

const deployModelsPath = require.resolve('../../../tools/face-model/deploy-models');
const predeployModelsPath = require.resolve('../../../tools/face-model/predeploy-models');

function withFakeDeployModels(fakeExports, fn) {
  const original = require.cache[deployModelsPath];
  require.cache[deployModelsPath] = {
    id: deployModelsPath,
    filename: deployModelsPath,
    loaded: true,
    exports: fakeExports,
  };
  delete require.cache[predeployModelsPath];
  try {
    return fn(require('../../../tools/face-model/predeploy-models'));
  } finally {
    if (original) {
      require.cache[deployModelsPath] = original;
    } else {
      delete require.cache[deployModelsPath];
    }
    delete require.cache[predeployModelsPath];
  }
}

test('runPredeploy() skips deploy() and resolves when prerequisites are not ready', async () => {
  let deployCalled = false;
  await withFakeDeployModels(
    {
      checkPrerequisites: () => ({ ready: false, missing: [path.join('client', 'node_modules')] }),
      deploy: async () => {
        deployCalled = true;
      },
    },
    (mod) => mod.runPredeploy()
  );
  assert.equal(deployCalled, false, 'deploy() must not run when prerequisites are missing');
});

test('runPredeploy() calls deploy() and resolves when prerequisites are ready', async () => {
  let deployCalled = false;
  await withFakeDeployModels(
    {
      checkPrerequisites: () => ({ ready: true }),
      deploy: async () => {
        deployCalled = true;
      },
    },
    (mod) => mod.runPredeploy()
  );
  assert.equal(deployCalled, true, 'deploy() must run when prerequisites are ready');
});

test('runPredeploy() swallows a deploy() rejection instead of throwing', async () => {
  await assert.doesNotReject(
    withFakeDeployModels(
      {
        checkPrerequisites: () => ({ ready: true }),
        deploy: async () => {
          throw new Error('EMBEDDER_SHA256 mismatch after download');
        },
      },
      (mod) => mod.runPredeploy()
    )
  );
});

test('runPredeploy() swallows a checkPrerequisites() throw instead of throwing', async () => {
  await assert.doesNotReject(
    withFakeDeployModels(
      {
        checkPrerequisites: () => {
          throw new Error('boom');
        },
        deploy: async () => {},
      },
      (mod) => mod.runPredeploy()
    )
  );
});

test('runPredeploy() swallows a require()-time throw from deploy-models.js itself', async () => {
  // Simulates deploy-models.js (or something it pulls in, e.g. lib/fetchVerify.js)
  // throwing at module-load time rather than at call time.
  const original = require.cache[deployModelsPath];
  require.cache[deployModelsPath] = {
    id: deployModelsPath,
    filename: deployModelsPath,
    loaded: true,
    get exports() {
      throw new Error('module load failure');
    },
  };
  delete require.cache[predeployModelsPath];
  try {
    const mod = require('../../../tools/face-model/predeploy-models');
    await assert.doesNotReject(mod.runPredeploy());
  } finally {
    if (original) {
      require.cache[deployModelsPath] = original;
    } else {
      delete require.cache[deployModelsPath];
    }
    delete require.cache[predeployModelsPath];
  }
});
