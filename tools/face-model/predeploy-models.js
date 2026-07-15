#!/usr/bin/env node
/**
 * Soft, non-fatal wrapper around deploy-models.js, run automatically via
 * package.json's `prestart`/`predev` — npm lifecycle hooks fire once when the
 * `start`/`dev` script itself is invoked, not on nodemon's internal restarts,
 * so this runs once per `npm start`/`npm run dev`, not on every file-change
 * restart.
 *
 * Unlike `node deploy-models.js` (a deliberate, explicit invocation that
 * should hard-fail loudly on any problem), this wrapper must NEVER block a
 * normal server boot — face check-in is an optional feature, and most local/
 * CI boots won't have the model-build prerequisites at all. Every outcome
 * here exits 0:
 *   - Prerequisites missing (the common case — model not built, or `client/`
 *     deps not installed) -> one quiet informational line, skip.
 *   - Prerequisites present but the deploy itself fails (e.g. a network blip
 *     fetching the pinned landmarker) -> a warning with the error, skip.
 *     Face check-in just stays unreachable (404 on the model-manifest route)
 *     exactly as it would if this automation didn't exist — not a regression.
 *   - Success -> deploy-models.js's own log lines are the confirmation.
 */
const { deploy, checkPrerequisites } = require('./deploy-models');

async function main() {
  const prereqs = checkPrerequisites();
  if (!prereqs.ready) {
    console.log(
      '[predeploy-models] face check-in models not built yet — skipping deployment ' +
        '(see docs/face-checkin-handoff.md §3.4 to set this up; not required for the rest of the app).'
    );
    return;
  }
  try {
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

main();
