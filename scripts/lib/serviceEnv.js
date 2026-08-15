/**
 * Shared setup logic for the GMgmt Windows Service, used by both the NSIS
 * installer's "Windows Service" section and a bare `npm run service:install`
 * on a dev machine, so both paths converge on the same configuration:
 *   - data/logs directories and the .env file under %ProgramData%\gmgmt
 *   - the bundled node.exe (if this is an installed copy) as the service's
 *     execPath, so the background service doesn't depend on a system-wide
 *     Node.js install
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

// Values from env.sample / the installer's seeded .env that must never be
// used as real secrets - shipping a fixed, publicly-known JWT signing key
// to every install would let anyone forge staff session tokens.
const PLACEHOLDER_JWT_SECRETS = new Set(['', 'your_super_secret_jwt_key']);

function getDataDir() {
  const base = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(base, 'gmgmt');
}

function getBundledNodeExe(projectRoot) {
  const exe = path.join(projectRoot, 'node.exe');
  return fs.existsSync(exe) ? exe : undefined;
}

/**
 * Ensures %ProgramData%\gmgmt\{data,logs} exist and that a .env file is
 * present there, seeding it from the project's own .env (preferred) or
 * env.sample if one doesn't already exist. Never overwrites an existing
 * .env, so re-running `service:install` won't clobber prior configuration.
 */
function ensureServiceEnvironment(projectRoot) {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const locked = lockDownDataDir(dataDir);
  fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });

  const envPath = path.join(dataDir, '.env');
  if (!fs.existsSync(envPath)) {
    const source = ['.env', 'env.sample']
      .map((f) => path.join(projectRoot, f))
      .find((f) => fs.existsSync(f));
    if (source) {
      fs.copyFileSync(source, envPath);
      console.log(`📄 Seeded ${envPath} from ${path.basename(source)}`);
    } else {
      console.log(`⚠️  No .env or env.sample found in ${projectRoot}; skipping seed of ${envPath}`);
    }
  }

  if (locked) {
    ensureGeneratedSecrets(envPath, dataDir);
  } else {
    console.error(
      `❌ Refusing to write secrets/credentials into ${dataDir} because its permissions could not be restricted.`
    );
    // Callers (service-install.js, service-manage.js) use the returned
    // dataDir directly as the service's workingDirectory without checking
    // for a hardening failure - installing/starting the service against a
    // directory that may still have broken/world-readable ACLs would run
    // it against a state this function was supposed to prevent. Abort here
    // instead of returning a dataDir that looks the same either way.
    process.exit(1);
  }

  return dataDir;
}

/**
 * Locks down %ProgramData%\gmgmt so only SYSTEM and Administrators can read
 * it - ProgramData's default DACL grants ordinary local users read access,
 * which would expose JWT_SECRET/DEVICE_SHARED_SECRET/the admin password
 * and the member/biometric SQLite DB. This is the single enforcement
 * point: both the NSIS installer's service-install step and a bare
 * `npm run service:install` funnel through ensureServiceEnvironment, so
 * neither path can create the directory without hardening it first.
 *
 * Two icacls calls, not one - confirmed on real hardware that combining
 * them breaks existing files. `/grant:r "SID:(OI)(CI)F" /T` applies the
 * (OI)(CI) *container*-inherit flags directly to every object the /T walk
 * touches, including pre-existing leaf FILES (e.g. a gmgmt.sqlite from an
 * install predating this fix) - Windows doesn't accept those flags on a
 * non-container object, and the grant silently fails to attach, leaving
 * the file with an empty DACL that denies even SYSTEM. Splitting into (1)
 * set the inheritable grant on the directory itself, then (2) `/reset /T`
 * to make every descendant re-inherit cleanly from it, avoids ever
 * applying container flags to a file directly.
 */
function lockDownDataDir(dataDir) {
  if (process.platform !== 'win32') return true;
  try {
    execFileSync(
      'icacls',
      [dataDir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'],
      { stdio: 'pipe' }
    );
    // Target dataDir\* (contents only), not dataDir itself - /reset on
    // dataDir would revert the explicit grant just set above back to
    // inheriting from dataDir's own parent (%ProgramData%, not locked
    // down), undoing the lockdown before it ever takes effect.
    execFileSync('icacls', [`${dataDir}\\*`, '/reset', '/T'], { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.log(`⚠️  Failed to restrict permissions on ${dataDir}: ${error.message}`);
    return false;
  }
}

/**
 * Ensures the .env contains real, per-install secrets rather than the
 * placeholders committed to the repo (and shipped in the installer):
 *   - JWT_SECRET: replaced with a random value when missing or still the
 *     env.sample placeholder
 *   - DEVICE_SHARED_SECRET: generated when missing, so the ESP32 device
 *     endpoints (reachable through the firewall rule the installer opens
 *     on BIOMETRIC_PORT) never run unauthenticated in production
 *   - INITIAL_ADMIN_USERNAME/PASSWORD: generated when missing, so a fresh
 *     install has a working login (authService only seeds an admin from
 *     these vars, and only while the staff table is empty). The generated
 *     password is written to FIRST-RUN-CREDENTIALS.txt in the data dir.
 */
function ensureGeneratedSecrets(envPath, dataDir) {
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const values = {};
  lines.forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m) values[m[1]] = m[2].trim();
  });

  const updates = {};
  if (PLACEHOLDER_JWT_SECRETS.has(values.JWT_SECRET ?? '')) {
    updates.JWT_SECRET = crypto.randomBytes(48).toString('hex');
  }
  if (!values.DEVICE_SHARED_SECRET) {
    updates.DEVICE_SHARED_SECRET = crypto.randomBytes(32).toString('hex');
  }
  let generatedAdminPassword;
  if (!values.INITIAL_ADMIN_USERNAME && !values.INITIAL_ADMIN_PASSWORD) {
    generatedAdminPassword = crypto.randomBytes(9).toString('base64url');
    updates.INITIAL_ADMIN_USERNAME = 'admin';
    updates.INITIAL_ADMIN_PASSWORD = generatedAdminPassword;
  }

  if (Object.keys(updates).length === 0) return;

  // Snapshot separately from `updates` so every line matching a given key
  // - not just the first - gets rewritten to the same value. dotenv keeps
  // the LAST occurrence of a duplicate key, so leaving an earlier stale
  // duplicate untouched (as a delete-on-first-match would) risks silently
  // discarding the freshly generated secret in favor of the old one.
  const finalValues = { ...updates };
  const appendedKeys = new Set();
  const updated = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && finalValues[m[1]] !== undefined) {
      appendedKeys.add(m[1]);
      return `${m[1]}=${finalValues[m[1]]}`;
    }
    return line;
  });
  Object.entries(finalValues).forEach(([key, value]) => {
    if (!appendedKeys.has(key)) updated.push(`${key}=${value}`);
  });
  fs.writeFileSync(envPath, `${updated.join('\n').replace(/\n+$/, '')}\n`);
  console.log(`🔐 Generated per-install secrets in ${envPath}`);

  if (generatedAdminPassword) {
    const credsPath = path.join(dataDir, 'FIRST-RUN-CREDENTIALS.txt');
    fs.writeFileSync(
      credsPath,
      [
        'GMgmt first-run administrator credentials',
        '',
        '  Username: admin',
        `  Password: ${generatedAdminPassword}`,
        '',
        'Log in at http://localhost:3001, change this password, then delete',
        'this file.',
        '',
      ].join('\n')
    );
    console.log(`🔑 Initial admin credentials written to ${credsPath}`);
  }
}

// The SCM key name node-windows registers is the lowercased service id
// with '.exe' appended - "GMgmt" is only the display name (see
// node_modules/node-windows/lib/daemon.js: id getter, _exe getter).
const SERVICE_QUERY_NAME = 'gmgmt.exe';

/**
 * Polls the Service Control Manager until the service reports RUNNING or
 * timeoutMs elapses. node-windows routes install/start/stop through an
 * elevation helper that detaches the real work into a hidden window: its
 * 'install'/'start' events fire when the helper LAUNCHES, not when the
 * operation actually succeeds, so trusting them reports false success on
 * a crash-looping service. The SCM is the only reliable signal.
 */
function waitForServiceRunning(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastOutput = '(no output)';
  while (Date.now() < deadline) {
    try {
      lastOutput = execSync(`sc query ${SERVICE_QUERY_NAME}`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      if (lastOutput.includes('RUNNING')) return true;
    } catch (error) {
      lastOutput = `${error.stdout || ''}${error.stderr || ''}` || error.message;
    }
    execSync('powershell -NoProfile -Command "Start-Sleep -Milliseconds 1000"', { stdio: 'pipe' });
  }
  console.error('❌ Service did not reach RUNNING state. Last status:');
  console.error(lastOutput);
  console.error(`   Check the logs in ${path.join(getDataDir(), 'logs')} for details.`);
  return false;
}

module.exports = {
  getDataDir,
  getBundledNodeExe,
  ensureServiceEnvironment,
  waitForServiceRunning,
  SERVICE_QUERY_NAME,
};
