---
name: verify
description: Run the full test suite (backend unit tests + ESP32 integration tests) before marking work done. Use this after making changes to confirm nothing is broken.
---

Run the following commands in order and report results. Stop and surface failures immediately — do not continue past a failing step.

1. **Backend unit tests** (the suite uses node:test, not jest). The glob must be
   UNQUOTED — node does not expand globs itself, the shell must:
   ```bash
   node --test src/services/__tests__/*.test.js
   ```
   Preflight: if suites fail with `NODE_MODULE_VERSION` errors, that is an
   environment problem, not a code regression — better-sqlite3's native module
   needs Node >= 20 (e.g. `~/.nvm/versions/node/v22.21.1/bin/node`). Switch
   node versions and rerun before reporting failures.

2. **ESP32 integration tests** (needs the server up — start it first if it isn't:
   `JWT_SECRET=<any> ENABLE_BIOMETRIC=true BIOMETRIC_PORT=5005 node src/app.js`):
   ```bash
   npm run esp32:test
   ```

After both pass, confirm to the user that verification succeeded. If either fails, show the error output and wait for instructions before proceeding.
