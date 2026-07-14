# Windows Testing Guide

What's already Windows-safe in this codebase, what needs a small workaround,
and what's genuinely not supported yet. For ESP32/firmware specifics see
[`../ESP32_DEPLOYMENT_GUIDE.md`](../ESP32_DEPLOYMENT_GUIDE.md).

## Prerequisites

- **Node ≥ 20** (`.nvmrc` pins `22`). `better-sqlite3` ships a native binding
  compiled against a specific Node ABI — if you switch Node versions (e.g.
  via nvm-windows) and the server fails to start with a `NODE_MODULE_VERSION`
  mismatch, run `npm rebuild better-sqlite3` under the Node version you're
  actually using.
- Git for Windows (needed to clone the repo anyway) also provides the Git
  Bash shell that Husky's pre-commit hooks run under.

## What already works, no workaround needed

- **Database location**: `src/config/sqlite.js` defaults to
  `%ProgramData%\gmgmt` on `win32` (or override with `WIN_DATA_ROOT`) —
  handled automatically, nothing to configure.
- **npm scripts**: every script that sets an env var inline uses `cross-env`,
  so `npm start`, `npm run dev`, etc. behave the same in `cmd.exe`,
  PowerShell, and bash.
- **ESP32 TCP listener**: binds `0.0.0.0`, no platform-specific socket code.
- **`npm run esp32:setup`**: an explicitly cross-platform Node script (see
  its own header comment) — no shell-specific setup step required.
- **The face check-in kiosk** (`/checkin`): pure browser code — camera
  access and the on-device model runtime (LiteRT.js/MediaPipe WASM) work
  identically in Chrome/Edge on Windows. Nothing to configure beyond a
  supported browser.
- **Face model deployment** (`tools/face-model/deploy-models.js` and
  `download-models.js`): ported to plain Node (`fs`/`crypto`/`https` only —
  no shell, no `sha256sum`/`curl`/`cp` dependency). Run with
  `node tools/face-model/deploy-models.js` from anywhere Node ≥ 20 is on the
  PATH.

## Built-in diagnostics

```bash
npm run esp32:test:system    # platform, arch, Node version, PowerShell availability
npm run esp32:test:windows   # Windows-only: network adapters + a firewall-rule
                              # check for BIOMETRIC_PORT (netsh), with a suggested
                              # `netsh advfirewall` rule to add if one is missing
```

If ESP32 devices on the LAN can't reach the backend, start with
`esp32:test:windows` — it's specifically built to surface the Windows
Firewall gap.

## Known gaps (not fixed, worth knowing before relying on them)

- **`tools/simulate-esp32-door.js`** (a local dev tool that simulates a
  physical ESP32 for testing without hardware) needs to bind port 80 and
  prints a `sudo ...` hint on bind failure — that's Unix-specific. On
  Windows the equivalent is running the terminal as Administrator, or
  reserving the port via `netsh http add urlacl url=http://+:80/ user=Everyone`.
  This only affects using that specific dev tool; it has no bearing on
  production, where the ESP32 hardware itself owns port 80 as embedded
  firmware, independent of whatever OS runs the backend.
- The offline face-model **conversion/evaluation tooling** (`convert.py`,
  `evaluate.py`, the `tools/face-model/.venv` Python environment) is
  developer-only, one-time tooling for building the models that get
  committed/deployed — not something a gym's Windows deployment machine ever
  runs, and it hasn't been verified cross-platform.
