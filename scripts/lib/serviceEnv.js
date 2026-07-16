/**
 * Shared setup logic for the GMgmt Windows Service, used by both the NSIS
 * installer's "Windows Service" section and a bare `npm run service:install`
 * on a dev machine, so both paths converge on the same configuration:
 *   - data/logs directories and the .env file under %ProgramData%\gmgmt
 *   - the bundled node.exe (if this is an installed copy) as the service's
 *     execPath, so the background service doesn't depend on a system-wide
 *     Node.js install
 */

const fs = require("fs");
const path = require("path");

function getDataDir() {
  const base = process.env.ProgramData || "C:\\ProgramData";
  return path.join(base, "gmgmt");
}

function getBundledNodeExe(projectRoot) {
  const exe = path.join(projectRoot, "node.exe");
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
  fs.mkdirSync(path.join(dataDir, "data"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "logs"), { recursive: true });

  const envPath = path.join(dataDir, ".env");
  if (!fs.existsSync(envPath)) {
    const source = [".env", "env.sample"]
      .map((f) => path.join(projectRoot, f))
      .find((f) => fs.existsSync(f));
    if (source) {
      fs.copyFileSync(source, envPath);
      console.log(`📄 Seeded ${envPath} from ${path.basename(source)}`);
    } else {
      console.log(
        `⚠️  No .env or env.sample found in ${projectRoot}; skipping seed of ${envPath}`,
      );
    }
  }

  return dataDir;
}

module.exports = { getDataDir, getBundledNodeExe, ensureServiceEnvironment };
