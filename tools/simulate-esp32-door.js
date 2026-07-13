#!/usr/bin/env node
/*
 * Simulated ESP32 door lock — for local testing of the face check-in flow.
 *
 * Mirrors the real firmware's two touch points with the backend
 * (see esp32_door_lock/esp32_door_lock.ino + src/services/biometricIntegration.js):
 *
 *   1. Self-registration: POST /api/biometric/esp32-webhook  { event:'heartbeat', ... }
 *      -> upserts the `devices` row with status='online' and this box's ip_address.
 *      Repeated on an interval to stay "online".
 *
 *   2. Command channel: the backend unlocks by POSTing to  http://<ip>:80/command
 *      { deviceId, command, data, ... }.  The two unlock commands are
 *      'unlock_door' (data:{ reason, duration }) and 'access_granted'
 *      (data:{ memberName, memberId }).  We serve that here and "toggle the
 *      relay" (just logging), then re-lock after the hold duration.
 *
 * Because the backend hard-codes port 80 for the command channel, this HTTP
 * server MUST listen on port 80 — which on macOS/Linux needs root, so run with
 * sudo (see the run instructions printed if the bind fails).
 */

const http = require('http');

// Parse a positive-integer env var, falling back to `def` on unset/blank/NaN.
// Guards against e.g. LISTEN_PORT=abc crashing server.listen with a raw
// RangeError, or HEARTBEAT_MS=abc becoming NaN → a ~1ms hot loop.
function intEnv(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`⚠️  ${name}="${raw}" is not a positive number — using default ${def}.`);
    return def;
  }
  return n;
}

// Use 127.0.0.1, not "localhost": Node may resolve localhost to IPv6 ::1, but
// the backend binds IPv4 (0.0.0.0), so localhost would ECONNREFUSED on ::1.
const BACKEND = process.env.BACKEND || 'http://127.0.0.1:3001';
const SECRET = process.env.DEVICE_SHARED_SECRET || 'dev-face-secret';
const DEVICE_ID = process.env.DEVICE_ID || 'SIM_DOOR_01';
const LISTEN_IP = process.env.LISTEN_IP || '127.0.0.1';
const LISTEN_PORT = intEnv('LISTEN_PORT', 80); // backend hard-codes 80
const HEARTBEAT_MS = intEnv('HEARTBEAT_MS', 30000);

let relayLocked = true; // HIGH = locked, matching the firmware's default
let reLockTimer = null;

function ts() {
  return new Date().toISOString();
}
function log(...a) {
  console.log(`[${ts()}]`, ...a);
}

// ---- 1. Registration heartbeat --------------------------------------------
function sendHeartbeat() {
  const body = JSON.stringify({
    event: 'heartbeat',
    deviceId: DEVICE_ID,
    deviceType: 'esp32_door_lock',
    device_name: 'Simulated Door Lock',
    status: 'online',
    ip_address: LISTEN_IP,
    firmware_version: 'sim-1.0',
    wifi_rssi: -50,
    free_heap: 200000,
    enrolled_prints: 0,
    timestamp: ts(),
  });

  const url = new URL('/api/biometric/esp32-webhook', BACKEND);
  const req = http.request(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Device-Secret': SECRET,
        'User-Agent': 'SimulatedESP32DoorLock/1.0',
      },
      timeout: 10000, // mirror the backend's sendHTTPCommandToDevice timeout
    },
    (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          log(`💓 heartbeat ok — registered '${DEVICE_ID}' @ ${LISTEN_IP} (online)`);
        } else {
          log(`⚠️  heartbeat HTTP ${res.statusCode}: ${data}`);
          if (res.statusCode === 401) {
            log('   -> device secret rejected. Ensure the backend .env DEVICE_SHARED_SECRET');
            log(`      matches this script's SECRET ("${SECRET}") and the backend was restarted.`);
          }
        }
      });
    }
  );
  let timedOut = false;
  req.on('error', (e) => {
    // destroy() below tears the socket down, which re-surfaces here as
    // ECONNRESET — skip the redundant line since 'timeout' already logged.
    if (timedOut) return;
    log(`⚠️  heartbeat failed: ${e.message} (is the backend up at ${BACKEND}?)`);
  });
  req.on('timeout', () => {
    timedOut = true;
    log(`⚠️  heartbeat timed out after 10s (backend accepted the connection but never replied)`);
    req.destroy();
  });
  req.write(body);
  req.end();
}

// ---- 2. Command channel (the door) ----------------------------------------
function handleCommand(payload, res) {
  const command = payload.command;
  const reason = payload.data && payload.data.reason;
  log(`⬇️  command received: '${command}'${reason ? ` (reason: ${reason})` : ''}`);

  if (command === 'unlock_door' || command === 'access_granted') {
    relayLocked = false;
    // Match the firmware's hold times when the backend doesn't specify one:
    // access_granted holds for DOOR_UNLOCK_TIME (3s), unlock_door for
    // EMERGENCY_UNLOCK_TIME (5s). See esp32_door_lock.ino.
    const defaultMs = command === 'access_granted' ? 3000 : 5000;
    const durationMs = (payload.data && payload.data.duration) || defaultMs;
    console.log('');
    log('🔓🔓🔓  DOOR UNLOCKED  🔓🔓🔓  (relay -> LOW)');
    console.log('');
    if (reLockTimer) clearTimeout(reLockTimer);
    reLockTimer = setTimeout(() => {
      relayLocked = true;
      log(`🔒 door re-locked after ${durationMs}ms (relay -> HIGH)`);
    }, durationMs);
  } else {
    log(`ℹ️  command '${command}' acknowledged (no relay action)`);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      success: true,
      deviceId: DEVICE_ID,
      command,
      relayLocked,
    })
  );
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/command') {
    let raw = '';
    // Without this, a client that resets mid-request emits 'error' on the
    // request stream with no listener, which crashes the process.
    req.on('error', (e) => log(`⚠️  command request stream error: ${e.message}`));
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(raw || '{}');
      } catch (_) {
        /* tolerate non-JSON like the firmware does */
      }
      handleCommand(payload, res);
    });
    return;
  }
  // Simple status/health endpoints for poking with curl
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      deviceId: DEVICE_ID,
      relayLocked,
      door: relayLocked ? 'locked' : 'unlocked',
    })
  );
});

server.on('error', (e) => {
  if (e.code === 'EACCES') {
    console.error(`\n❌ Cannot bind port ${LISTEN_PORT} — needs elevated privileges.`);
    console.error(
      '   The backend hard-codes port 80 for the door command channel, so run with sudo.'
    );
    console.error('   Export the device secret first so it survives sudo (and stays out of');
    console.error('   your shell history / the process list), then use sudo -E:');
    console.error('     export DEVICE_SHARED_SECRET=<your-secret>');
    console.error('     sudo -E node tools/simulate-esp32-door.js\n');
  } else if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${LISTEN_PORT} is already in use (another process is bound to it).\n`);
  } else {
    console.error('server error:', e);
  }
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_IP, () => {
  log(`🚪 Simulated ESP32 door lock listening on http://${LISTEN_IP}:${LISTEN_PORT}/command`);
  log(`   device_id = "${DEVICE_ID}"   backend = ${BACKEND}`);
  log('   Enter this device_id as the "Door Device ID" in Settings -> Face Check-In.');
  // The /command channel is unauthenticated (it mirrors the real firmware, which
  // trusts anything the backend POSTs to it). That's fine on loopback, but on a
  // routable interface anyone who can reach this port can "unlock the door".
  const isLoopback = (ip) => ip === '::1' || ip === 'localhost' || /^127\./.test(ip);
  if (!isLoopback(LISTEN_IP)) {
    log(
      `⚠️  bound to non-loopback ${LISTEN_IP} — the /command channel is unauthenticated; ` +
        'anyone who can reach this port can trigger an unlock. Use 127.0.0.1 unless you know why.'
    );
  }
  // The backend always POSTs unlock commands to port 80 (it can't discover any
  // other port), so a non-80 bind still registers "online" via heartbeats but
  // the door will never actually fire — warn rather than let it look healthy.
  if (LISTEN_PORT !== 80) {
    log(
      `⚠️  LISTEN_PORT=${LISTEN_PORT} but the backend only ever POSTs commands to :80 — ` +
        'unlock commands will NOT reach this simulator. Run on port 80 for the door to fire.'
    );
  }
  sendHeartbeat();
  setInterval(sendHeartbeat, HEARTBEAT_MS);
});

process.on('SIGINT', () => {
  log('shutting down simulator');
  process.exit(0);
});
