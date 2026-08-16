#!/usr/bin/env node
/**
 * Soft, non-fatal wrapper around deploy-models.js. Invoked from two places:
 *   - package.json's `prestart`/`predev` — npm lifecycle hooks fire once when
 *     the `start`/`dev` script itself is invoked, not on nodemon's internal
 *     restarts, so this runs once per `npm start`/`npm run dev`.
 *   - `src/app.js` at boot, via `runPredeploy()` — the installed Windows
 *     Service launches `node.exe src/app.js` directly (see
 *     scripts/service-install.js), bypassing npm lifecycle hooks entirely,
 *     so the prestart hook above never fires for it. This is the actual
 *     production deployment path, so it needs its own call site.
 *
 * Unlike `node deploy-models.js` (a deliberate, explicit invocation that
 * should hard-fail loudly on any problem), this wrapper must NEVER block a
 * normal server boot — face check-in is an optional feature, and most local/
 * CI boots won't have `client/` deps installed at all. Every outcome here
 * resolves without throwing:
 *   - Prerequisites missing (the common case — `client/` deps not installed)
 *     -> one quiet informational line, skip.
 *   - Prerequisites present but the deploy itself fails (e.g. a network blip
 *     fetching a pinned artifact) -> a warning with the error, skip.
 *     Face check-in just stays unreachable (404 on the model-manifest route)
 *     exactly as it would if this automation didn't exist — not a regression.
 *   - Success -> deploy-models.js's own log lines are the confirmation.
 */
async function runPredeploy() {
  // `require` itself (deploy-models.js or anything it pulls in, e.g. lib/fetchVerify.js)
  // can throw at load time — that must be as non-fatal as a failed deploy() call,
  // so it's inside the try/catch below rather than at module top level.
  try {
    const { deploy, checkPrerequisites } = require('./deploy-models');

    const prereqs = checkPrerequisites();
    if (!prereqs.ready) {
      console.log(
        "[predeploy-models] face check-in prerequisites not met (run 'npm install' in " +
          'client/) — skipping model deployment; not required for the rest of the app.'
      );
      return;
    }
    await deploy();
  } catch (err) {
    console.warn(
      `[predeploy-models] face model deployment failed, continuing without it: ${err.message}`
    );
    console.warn(
      '[predeploy-models] run `node tools/face-model/deploy-models.js` manually to see full details.'
    );
  }
}

module.exports = { runPredeploy };

if (require.main === module) {
  runPredeploy();
}
