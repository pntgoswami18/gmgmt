# ESP32 Deployment Guide

How the backend talks to ESP32 door-lock devices, and how to set up, secure,
and test that integration. For Windows-specific setup/diagnostics, see
[`tools/WINDOWS_TESTING_GUIDE.md`](tools/WINDOWS_TESTING_GUIDE.md).

## How it works

Two independent channels, both defined in `src/services/biometricIntegration.js`:

1. **TCP listener** (`biometricListener.js`, default port `8080`, binds
   `0.0.0.0`) — ESP32 devices connect and send JSON events: fingerprint
   scans, enrollment progress, access results.
2. **HTTP webhook + command channel** — devices also call
   `POST /api/biometric/esp32-webhook` (heartbeat self-registration; a device
   isn't known to the backend until it sends one) and the backend, in turn,
   POSTs unlock/enroll commands to `http://<device-ip>:80/command`. The
   device's own tiny HTTP server on port 80 handles that — this is the
   ESP32's port, not the backend host's, so it needs no elevated privilege on
   whatever machine runs gmgmt.

Face check-in uses the same door-unlock command channel — `face_door_device_id`
(configured in Settings → Face Check-In) just names which registered device to
send `unlock_door` to on an authorized scan.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ENABLE_BIOMETRIC` | off | Starts the TCP listener + biometric integration at boot. Gyms with no fingerprint/face hardware leave this unset. |
| `BIOMETRIC_PORT` | `8080` | TCP listener port. |
| `BIOMETRIC_HOST` | `0.0.0.0` | TCP listener bind address. |
| `DEVICE_SHARED_SECRET` | unset | Shared secret every ESP32 device must send as `X-Device-Secret` on the webhook/validate/cache-update/firmware-download endpoints (`src/api/middleware/requireDeviceSecret.js`). Unset = check skipped (dev default); set it once every deployed device's firmware sends the header, so a mid-rollout flip doesn't lock out devices that haven't been reflashed yet. |

See `.env.sample` for the exact comments and a one-liner to generate a secret.

## Setup

```bash
npm run esp32:setup           # creates ESP32-related tables (cross-platform Node script)
npm run esp32:setup:manual    # alternative: raw sqlite3 CLI, if you prefer
```

## Firmware

Firmware lives in `esp32_door_lock/esp32_door_lock.ino`. It has a
`device_secret` preference (settable via the device's config portal) and
sends an `X-Device-Secret` header on its outbound calls once configured.

**OTA updates** go through `src/api/routes/firmware.js`:
- `POST /api/firmware/upload` — staff uploads a new firmware binary.
- `POST /api/firmware/update/:deviceId` — triggers the device to fetch it.
- `GET /api/firmware/download/:id` — the device downloads the binary. Since
  the ESP32 OTA library can't easily set custom headers, the backend embeds
  the device secret as a `?device_secret=` query param in the download URL it
  hands the device, rather than requiring a header here.

The OTA update code path in the `.ino` firmware itself is not compiled/tested
by anything in this repo — verify on real hardware before relying on it.

## Testing

```bash
npm run esp32:test            # full suite — heartbeat, fingerprint auth, API endpoints, full workflow
npm run esp32:test:tcp        # TCP connectivity only
npm run esp32:test:api        # REST API endpoints only
npm run esp32:test:network    # network reachability checks
npm run esp32:test:webhook    # webhook endpoint only
npm run esp32:test:windows    # Windows-specific diagnostics (see below)
npm run esp32:test:system     # system requirements check (platform, Node version, PowerShell availability)
```

`esp32:test` needs the backend running first:
```bash
JWT_SECRET=<any> ENABLE_BIOMETRIC=true BIOMETRIC_PORT=5005 node src/app.js
```

No physical ESP32 hardware is required to test the backend side —
`tools/simulate-esp32-door.js` simulates a device's heartbeat + unlock-command
handling on `localhost`. It binds port 80 (matching the backend's hard-coded
assumption for the command channel), so it needs elevated privileges on
whichever OS you run it on (`sudo` on macOS/Linux; run as Administrator on
Windows — this tool's own `sudo` hint is Unix-specific, not yet adapted for
Windows).
