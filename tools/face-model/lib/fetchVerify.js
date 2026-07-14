/**
 * Shared SHA-256 + pinned-download helpers for the face-model tooling
 * (deploy-models.js, download-models.js). Node-native (crypto/https/fs) so
 * these scripts run identically on macOS, Linux, and Windows — no shell,
 * no sha256sum/shasum/curl dependency.
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/** Throws with a clear mismatch message if the file's hash doesn't match. */
function verifySha(filePath, expectedSha, label = filePath) {
  const actual = sha256File(filePath);
  if (actual !== expectedSha) {
    throw new Error(
      `CHECKSUM MISMATCH for ${label}\n  expected: ${expectedSha}\n  actual:   ${actual}`
    );
  }
}

/**
 * Download `url` to `destPath`, following redirects (mirrors `curl -fsSL`/
 * `curl -fL`). Rejects on a non-2xx final status or too many redirects.
 */
function downloadFile(url, destPath, { maxRedirects = 5, retries = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, redirectsLeft, retriesLeft) => {
      const file = fs.createWriteStream(destPath);
      const req = https.get(currentUrl, (res) => {
        const { statusCode, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          if (redirectsLeft <= 0) {
            reject(new Error(`too many redirects fetching ${url}`));
            return;
          }
          attempt(new URL(headers.location, currentUrl).toString(), redirectsLeft - 1, retriesLeft);
          return;
        }
        if (statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          if (retriesLeft > 0) {
            attempt(currentUrl, redirectsLeft, retriesLeft - 1);
            return;
          }
          reject(new Error(`HTTP ${statusCode} fetching ${currentUrl}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      });
      req.on('error', (err) => {
        file.close();
        fs.rmSync(destPath, { force: true });
        if (retriesLeft > 0) {
          attempt(currentUrl, redirectsLeft, retriesLeft - 1);
        } else {
          reject(err);
        }
      });
    };
    attempt(url, maxRedirects, retries);
  });
}

/**
 * Fetch `url` to `outPath`, verifying against `expectedSha`. If `outPath`
 * already exists and matches, skips the download (mirrors both bash
 * scripts' idempotent re-run behavior). A stale/mismatched existing file is
 * removed and re-fetched; a mismatch after a fresh download is a hard error
 * — these weights gate a physical door lock, so a corrupted or substituted
 * artifact must never be silently accepted.
 */
async function fetchVerified(url, outPath, expectedSha, { retries = 3 } = {}) {
  if (fs.existsSync(outPath)) {
    const got = sha256File(outPath);
    if (got === expectedSha) {
      console.log(`ok: ${outPath} (sha256 verified)`);
      return;
    }
    console.log(`stale: ${outPath} (sha256 ${got} != ${expectedSha}) — re-fetching`);
    fs.rmSync(outPath, { force: true });
  }
  console.log(`fetching: ${outPath}`);
  const tmp = `${outPath}.tmp`;
  await downloadFile(url, tmp, { retries });
  const got = sha256File(tmp);
  if (got !== expectedSha) {
    fs.rmSync(tmp, { force: true });
    throw new Error(
      `${outPath} sha256 mismatch after download\n  expected: ${expectedSha}\n  got:      ${got}`
    );
  }
  fs.renameSync(tmp, outPath);
  console.log(`ok: ${outPath} (sha256 verified)`);
}

module.exports = { sha256File, verifySha, downloadFile, fetchVerified };
