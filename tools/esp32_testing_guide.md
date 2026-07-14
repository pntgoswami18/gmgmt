# ESP32 Comprehensive Testing Guide

A closer look at the ESP32 test tooling in `tools/` — what each script
actually sends/checks, and what it needs running first. For how the
integration works and its environment variables, see
[`../ESP32_DEPLOYMENT_GUIDE.md`](../ESP32_DEPLOYMENT_GUIDE.md) (its own
"Testing" section covers the npm script names); for Windows-specific
diagnostics see [`WINDOWS_TESTING_GUIDE.md`](WINDOWS_TESTING_GUIDE.md).

## Before you run anything

Most of the scripts here talk to a running backend, so start one first:

```bash
JWT_SECRET=<any> ENABLE_BIOMETRIC=true BIOMETRIC_PORT=5005 node src/app.js
```

The scripts read the same environment variables the backend does
(`BIOMETRIC_HOST` / `BIOMETRIC_PORT` for the TCP listener, `PORT` for the
HTTP API — see `.env`, loaded via `dotenv`), defaulting to `localhost:8080`
for TCP and `localhost:3001` for the API if unset. If you started the
backend with a non-default `BIOMETRIC_PORT`, export the same value before
running the test scripts, or they'll try to connect to the wrong port.

## `npm run esp32:test` — `tools/test_esp32_integration.js`

Runs `checkSystemRequirements()` and `testNetworkConnectivity()` first
(platform/arch/Node version, then `ping` + a port-reachability check —
`Test-NetConnection` on Windows, `nc -z` on Unix, falling back silently to
the TCP test if neither tool is available), then five tests in sequence:

| Test | What it does |
|---|---|
| TCP Connection | Opens a raw TCP socket to `BIOMETRIC_HOST:BIOMETRIC_PORT` and confirms it connects within 5s. |
| Fingerprint Message | Sends a newline-terminated JSON `TimeLog`/`FP` event over that TCP socket, mimicking a fingerprint scan. |
| Heartbeat Message | Sends a newline-terminated JSON `heartbeat` event (device status, wifi RSSI, free heap, enrolled print count). |
| API Endpoints | Hits `GET /api/biometric/devices`, `GET /api/biometric/devices/:id/status`, and `POST /api/biometric/devices/:id/unlock` against the HTTP API. |
| Full Workflow | Chains heartbeat → fingerprint auth → an `Enroll`/`enrollment_success` event → an `unauthorized` access-denied event, all over TCP. |

It reports a pass/fail count and a success-rate percentage at the end, and
exits non-zero if anything failed.

Individual pieces can be run directly instead of the whole suite:

```bash
npm run esp32:test          # everything above
npm run esp32:test:tcp      # just the TCP Connection test
npm run esp32:test:api      # just the API Endpoints test
npm run esp32:test:network  # just testNetworkConnectivity()
npm run esp32:test:system   # just checkSystemRequirements()
npm run esp32:test:windows  # Windows-only: network adapters + firewall rule check for BIOMETRIC_PORT
```

(`node tools/test_esp32_integration.js fingerprint`,
`heartbeat`, or `workflow` also work directly but have no corresponding npm
script.) `esp32:test:windows` exits with an error message if run on a
non-Windows platform — it calls `showWindowsDebugInfo()`, which shells out
to `powershell`/`netsh` and only makes sense there.

## `npm run esp32:test:webhook` — `tools/test_esp32_webhook.js`

Exercises the HTTP webhook side only (no TCP), against
`http://localhost:<PORT>/api/biometric`:

1. **Server health** — `GET /status`; fails fast (and skips the rest) if the
   server isn't reachable or returns HTML instead of JSON.
2. **Heartbeat webhook** — `POST /esp32-webhook` with a `heartbeat` payload.
3. **Fingerprint webhook** — `POST /esp32-webhook` with a `TimeLog`/`FP`
   payload.
4. **System status** — `GET /status` again, checking `connectedDevices` in
   the response.
5. **Biometric events** — `GET /events?limit=5`, checking whether the test
   device's events show up.
6. **Connection test** — `POST /test-connection`.

Each step waits 1 second before the next (giving the backend time to
process the previous webhook call) and prints a final pass/fail summary
across all six checks.

## `tools/simulate-esp32-door.js` — no physical hardware needed

Standalone script (no npm alias) that plays the role of a real ESP32 door
lock so you can test the full loop without hardware:

- Sends periodic heartbeats to `POST /api/biometric/esp32-webhook` to
  register itself and stay "online".
- Runs its own tiny HTTP server on **port 80** to receive the backend's
  `unlock_door` / `access_granted` commands — the same command channel
  described in the deployment guide. Because port 80 needs elevated
  privileges, run it with `sudo -E node tools/simulate-esp32-door.js` (the
  `-E` preserves `DEVICE_SHARED_SECRET` across the privilege escalation);
  the script prints this hint on an `EACCES` bind failure. The hint is
  macOS/Linux-specific — there's no Windows/Administrator equivalent in the
  script.
- Listens on `127.0.0.1` explicitly rather than `localhost`, since Node can
  resolve `localhost` to IPv6 `::1` while the backend binds IPv4 — see the
  comment at the top of the file for the full reasoning.

Useful for manually exercising the face check-in / fingerprint unlock flow
end-to-end in local dev without an ESP32 on the bench.

## Backend unit tests

The ESP32/biometric-adjacent pieces are covered by `node:test` files under
`src/services/__tests__/`, run as part of the full suite:

```bash
node --test 'src/services/__tests__/*.test.js'
```

Two files are specifically relevant here:

- **`biometricIntegration.test.js`** — exercises `BiometricIntegration`
  directly (e.g. that a failed ESP32 command during remote enrollment rolls
  the enrollment mode back and records the failure reason), independent of
  any running server or real device.
- **`requireDeviceSecret.test.js`** — covers the
  `src/api/middleware/requireDeviceSecret.js` middleware referenced in the
  deployment guide: no-op when `DEVICE_SHARED_SECRET` is unset, 401 on a
  missing or wrong `X-Device-Secret` header/query value when it is set.

To run just those two:

```bash
node --test src/services/__tests__/biometricIntegration.test.js src/services/__tests__/requireDeviceSecret.test.js
```

Note the separate `test:unit:biometric` npm script only points at
`biometricIntegration.test.js`; use the `node --test` invocations above to
also cover `requireDeviceSecret.test.js`.
