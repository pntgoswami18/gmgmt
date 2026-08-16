const test = require('node:test');
const assert = require('node:assert/strict');

// Exercises src/app.js's non-blocking boot call into
// tools/face-model/predeploy-models.js (`bootFaceModelPredeploy`, called from
// startServer() before server.listen()). startServer() itself isn't
// exported and pulls in real DB init, settings cache, and long-lived
// intervals, so it's not a viable unit-test target — bootFaceModelPredeploy
// is exported separately (as `_bootFaceModelPredeploy`, a test-only hook)
// specifically so this boundary can be covered: server boot must never
// crash because of this optional, best-effort subsystem, no matter how
// predeploy-models.js behaves.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.DEVICE_SHARED_SECRET = process.env.DEVICE_SHARED_SECRET || 'test-device-secret';

const app = require('../../app');
const predeployModelsPath = require.resolve('../../../tools/face-model/predeploy-models');

test('bootFaceModelPredeploy() does not throw when predeploy-models resolves normally', () => {
  const original = require.cache[predeployModelsPath];
  require.cache[predeployModelsPath] = {
    id: predeployModelsPath,
    filename: predeployModelsPath,
    loaded: true,
    exports: { runPredeploy: async () => {} },
  };
  try {
    assert.doesNotThrow(() => app._bootFaceModelPredeploy());
  } finally {
    if (original) {
      require.cache[predeployModelsPath] = original;
    } else {
      delete require.cache[predeployModelsPath];
    }
  }
});

test('bootFaceModelPredeploy() does not throw when predeploy-models.js throws synchronously at require() time', () => {
  const original = require.cache[predeployModelsPath];
  require.cache[predeployModelsPath] = {
    id: predeployModelsPath,
    filename: predeployModelsPath,
    loaded: true,
    get exports() {
      throw new Error('module load failure');
    },
  };
  try {
    // This is the exact regression the finding describes: if the inner
    // try/catch around require()/.runPredeploy() were ever dropped, this
    // throw would propagate out of startServer()'s try block and hit the
    // outer catch's process.exit(1) before server.listen() ever runs.
    assert.doesNotThrow(() => app._bootFaceModelPredeploy());
  } finally {
    if (original) {
      require.cache[predeployModelsPath] = original;
    } else {
      delete require.cache[predeployModelsPath];
    }
  }
});

test('bootFaceModelPredeploy() does not produce an unhandled rejection when runPredeploy() rejects', async () => {
  const original = require.cache[predeployModelsPath];
  require.cache[predeployModelsPath] = {
    id: predeployModelsPath,
    filename: predeployModelsPath,
    loaded: true,
    exports: {
      runPredeploy: async () => {
        throw new Error('deploy failed mid-fetch');
      },
    },
  };

  let unhandled = null;
  const onUnhandled = (err) => {
    unhandled = err;
  };
  process.on('unhandledRejection', onUnhandled);

  try {
    assert.doesNotThrow(() => app._bootFaceModelPredeploy());
    // The rejection is handled via a fire-and-forget .catch() inside
    // bootFaceModelPredeploy, not awaited — give the microtask queue a turn
    // to run it before asserting no unhandledRejection fired.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandled, null, 'runPredeploy() rejection must be caught, not left unhandled');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
    if (original) {
      require.cache[predeployModelsPath] = original;
    } else {
      delete require.cache[predeployModelsPath];
    }
  }
});
