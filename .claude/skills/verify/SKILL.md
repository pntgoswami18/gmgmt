---
name: verify
description: Run the full test suite (backend unit tests + ESP32 integration tests) before marking work done. Use this after making changes to confirm nothing is broken.
---

Run the following commands in order and report results. Stop and surface failures immediately — do not continue past a failing step.

1. **Backend unit tests:**
   ```bash
   npx jest src/services/__tests__/
   ```

2. **ESP32 integration tests:**
   ```bash
   npm run esp32:test
   ```

After both pass, confirm to the user that verification succeeded. If either fails, show the error output and wait for instructions before proceeding.
