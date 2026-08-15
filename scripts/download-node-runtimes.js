#!/usr/bin/env node

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Node 22.x LTS - the app requires Node >= 20 (better-sqlite3 ABI), and
// Node 18 is end-of-life. When bumping this version, update the SHA-256
// hashes below from https://nodejs.org/dist/v<version>/SHASUMS256.txt
// (and the matching pins in download-node-runtimes.ps1 / .bat).
const NODE_VERSION = '22.23.2';
const BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;

const downloads = [
  {
    arch: 'x64',
    filename: `node-v${NODE_VERSION}-win-x64.zip`,
    sha256: '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97',
    targetDir: 'vendor/node-win-x64',
  },
  {
    arch: 'x86',
    filename: `node-v${NODE_VERSION}-win-x86.zip`,
    sha256: '725c9e2bdd1c2016b41c995a81f4fa36ce4e2ee565b7455d8f889182727df647',
    targetDir: 'vendor/node-win-ia32',
  },
];

// Resolves redirects first (no file I/O involved), then opens the
// destination write stream only once for the final 200 response. Reusing
// `filename` across redirect hops - closing/unlinking the old attempt while
// immediately opening a new stream on the same path - raced two unordered
// async fs operations against each other and could unlink the file the new
// stream was actively writing into.
function followRedirects(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          resolve(followRedirects(response.headers.location, redirectsLeft - 1));
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with HTTP ${response.statusCode} for ${url}`));
          return;
        }
        resolve(response);
      })
      .on('error', reject);
  });
}

function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    console.log(`📥 Downloading ${filename}...`);

    followRedirects(url).then((response) => {
      const file = fs.createWriteStream(filename);
      const fail = (err) => {
        file.close(() => fs.unlink(filename, () => {}));
        reject(err);
      };
      response.on('error', fail);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`✅ Downloaded ${filename}`);
        resolve();
      });
      file.on('error', fail);
    }, reject);
  });
}

// The bundled node.exe runs as a Windows Service under LocalSystem on
// customer machines - verify the download against the pinned SHA-256 from
// nodejs.org's signed SHASUMS256.txt before extracting anything from it.
function verifyChecksum(zipFile, expectedSha256) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(zipFile)).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${zipFile}:\n  expected ${expectedSha256}\n  actual   ${actual}`
    );
  }
  console.log(`🔒 Verified SHA-256 of ${path.basename(zipFile)}`);
}

function extractZip(zipFile, targetDir) {
  console.log(`📦 Extracting ${zipFile}...`);

  // Use unzip command (available on macOS/Linux) or PowerShell (Windows)
  let extractCommand;
  if (process.platform === 'win32') {
    extractCommand = `powershell -Command "Expand-Archive -Path '${zipFile}' -DestinationPath '${targetDir}' -Force"`;
  } else {
    extractCommand = `unzip -o -q "${zipFile}" -d "${targetDir}"`;
  }

  execSync(extractCommand, { stdio: 'inherit' });

  // The zip contains a single node-v<version>-win-<arch>/ folder; the
  // extracted path is that folder name under targetDir (NOT the zip's
  // temp/-prefixed relative path).
  const extractedDir = path.join(targetDir, path.basename(zipFile, '.zip'));
  const nodeExe = path.join(extractedDir, 'node.exe');
  const targetExe = path.join(targetDir, 'node.exe');

  if (!fs.existsSync(nodeExe)) {
    throw new Error(
      `node.exe not found at ${nodeExe} after extraction - the zip layout may have changed`
    );
  }

  fs.copyFileSync(nodeExe, targetExe);
  fs.rmSync(extractedDir, { recursive: true, force: true });

  if (!fs.existsSync(targetExe)) {
    throw new Error(`Failed to place node.exe at ${targetExe}`);
  }
  console.log(`✅ Extracted node.exe to ${targetDir}`);
}

async function downloadNodeRuntimes() {
  try {
    console.log(`🚀 Downloading Node.js ${NODE_VERSION} runtimes for Windows...`);

    // Create vendor directories
    downloads.forEach((download) => {
      if (!fs.existsSync(download.targetDir)) {
        fs.mkdirSync(download.targetDir, { recursive: true });
        console.log(`📁 Created directory: ${download.targetDir}`);
      }
    });

    // Download and extract each runtime
    for (const download of downloads) {
      const url = `${BASE_URL}/${download.filename}`;
      const zipFile = path.join('temp', download.filename);

      // Create temp directory
      if (!fs.existsSync('temp')) {
        fs.mkdirSync('temp');
      }

      await downloadFile(url, zipFile);
      verifyChecksum(zipFile, download.sha256);
      extractZip(zipFile, download.targetDir);

      // Clean up zip file
      fs.unlinkSync(zipFile);
    }

    // Clean up temp directory
    fs.rmdirSync('temp');

    console.log('🎉 Successfully downloaded and extracted Node.js runtimes!');
    console.log('\n📋 Next steps:');
    console.log('1. Verify the runtimes are in place:');
    console.log('   - vendor/node-win-x64/node.exe');
    console.log('   - vendor/node-win-ia32/node.exe');
    console.log('2. Test the runtimes:');
    console.log('   vendor/node-win-x64/node.exe --version');
    console.log('   vendor/node-win-ia32/node.exe --version');
  } catch (error) {
    console.error('❌ Error downloading Node.js runtimes:', error.message);
    downloads.forEach((download) => {
      const zipFile = path.join('temp', download.filename);
      if (fs.existsSync(zipFile)) {
        fs.unlinkSync(zipFile);
      }
    });
    if (fs.existsSync('temp')) {
      fs.rmdirSync('temp');
    }
    process.exit(1);
  }
}

// Run the script
downloadNodeRuntimes();
