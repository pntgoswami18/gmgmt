#!/usr/bin/env node
/**
 * Runs `node --check` on each path. Node only validates the first file when
 * multiple paths are passed, so this wrapper is required for lint-staged.
 */
const { spawnSync } = require('child_process');

const node = process.execPath;
let exitCode = 0;

for (const file of process.argv.slice(2)) {
  const result = spawnSync(node, ['--check', file], { stdio: 'inherit' });
  if (result.status) {
    exitCode = result.status || 1;
  }
}

process.exit(exitCode);
