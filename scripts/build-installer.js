#!/usr/bin/env node

/**
 * GMgmt Windows Installer Build Script
 *
 * This script automates the creation of Windows installers for GMgmt
 * using NSIS (Nullsoft Scriptable Install System).
 *
 * Usage:
 *   node scripts/build-installer.js [options]
 *
 * Options:
 *   --arch <architecture>  Target architecture (x64, x86, both)
 *   --clean                Clean build directory before building
 *   --help                 Show help information
 *
 * Examples:
 *   node scripts/build-installer.js --arch x64
 *   node scripts/build-installer.js --arch both --clean
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Configuration
const CONFIG = {
  projectName: "GMgmt",
  version: "1.0.0",
  buildDir: "dist",
  installerDir: "installer",
  nsisScript: "installer/gmgmt-installer.nsi",
  icon: "installer/gmgmt.ico",
  architectures: ["x64", "x86"],
};

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  arch: "both",
  clean: false,
  help: false,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--arch":
      options.arch = args[++i];
      break;
    case "--clean":
      options.clean = true;
      break;
    case "--help":
      options.help = true;
      break;
  }
}

function showHelp() {
  console.log(`
🔨 GMgmt Windows Installer Build Script

Usage: node scripts/build-installer.js [options]

Options:
  --arch <architecture>  Target architecture (x64, x86, both)
  --clean                Clean build directory before building
  --help                 Show help information

Examples:
  node scripts/build-installer.js --arch x64
  node scripts/build-installer.js --arch both --clean

Requirements:
  - NSIS (Nullsoft Scriptable Install System) installed
  - Windows operating system
  - Node.js runtimes in vendor/ directory
  - Built frontend in client/build/
`);
}

function checkRequirements() {
  console.log("🔍 Checking build requirements...");

  // Check if we're on Windows
  if (process.platform !== "win32") {
    console.error("❌ This script is designed for Windows only.");
    console.error("   Current platform:", process.platform);
    process.exit(1);
  }

  // Check if NSIS is installed
  try {
    execSync("makensis /VERSION", { stdio: "pipe" });
    console.log("✅ NSIS is installed");
  } catch (error) {
    console.error(
      "❌ NSIS not found. Please install NSIS from https://nsis.sourceforge.io/",
    );
    process.exit(1);
  }

  // Check if Node.js runtimes exist
  const x64Runtime = path.join("vendor", "node-win-x64", "node.exe");
  const x86Runtime = path.join("vendor", "node-win-ia32", "node.exe");

  if (!fs.existsSync(x64Runtime)) {
    console.error("❌ x64 Node.js runtime not found:", x64Runtime);
    console.error("   Run: node scripts/download-node-runtimes.js");
    process.exit(1);
  }

  if (!fs.existsSync(x86Runtime)) {
    console.error("❌ x86 Node.js runtime not found:", x86Runtime);
    console.error("   Run: node scripts/download-node-runtimes.js");
    process.exit(1);
  }

  console.log("✅ Node.js runtimes found");

  // Check if frontend is built
  const buildDir = path.join("client", "build");
  if (!fs.existsSync(buildDir)) {
    console.error("❌ Frontend build not found:", buildDir);
    console.error("   Run: cd client && npm run build");
    process.exit(1);
  }

  console.log("✅ Frontend build found");

  // Check if installer script exists
  if (!fs.existsSync(CONFIG.nsisScript)) {
    console.error("❌ NSIS script not found:", CONFIG.nsisScript);
    process.exit(1);
  }

  console.log("✅ NSIS script found");

  // Check the installer icon exists
  if (!fs.existsSync(CONFIG.icon)) {
    console.error("❌ Installer icon not found:", CONFIG.icon);
    process.exit(1);
  }

  console.log("✅ Installer icon found");

  // The installer bundles node_modules wholesale (`File /r "node_modules\*"`
  // in gmgmt-installer.nsi) - warn if devDependencies are still present, so
  // we don't ship dev-only tooling (and its potentially wrong-architecture
  // native modules) inside the installer.
  checkProductionNodeModules();
}

function checkProductionNodeModules() {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const devDeps = Object.keys(pkg.devDependencies || {});
  const installedDevDeps = devDeps.filter((name) =>
    fs.existsSync(path.join("node_modules", name)),
  );

  if (installedDevDeps.length > 0) {
    console.error("❌ devDependencies are present in node_modules:");
    installedDevDeps.forEach((name) => console.error("   -", name));
    console.error(
      "   The installer bundles node_modules as-is, so dev-only packages",
    );
    console.error(
      "   would ship to end users. Run a production-only install first:",
    );
    console.error("     npm ci --omit=dev");
    console.error(
      "   (re-run `npm install` afterwards if you need devDependencies",
    );
    console.error("   back for local development)");
    process.exit(1);
  }

  console.log("✅ node_modules contains no devDependencies");
}

function cleanBuildDirectory() {
  if (options.clean && fs.existsSync(CONFIG.buildDir)) {
    console.log("🧹 Cleaning build directory...");
    fs.rmSync(CONFIG.buildDir, { recursive: true, force: true });
    console.log("✅ Build directory cleaned");
  }
}

function prepareBuildDirectory() {
  console.log("📁 Preparing build directory...");

  if (!fs.existsSync(CONFIG.buildDir)) {
    fs.mkdirSync(CONFIG.buildDir, { recursive: true });
  }

  // Create architecture-specific directories
  CONFIG.architectures.forEach((arch) => {
    const archDir = path.join(CONFIG.buildDir, arch);
    if (!fs.existsSync(archDir)) {
      fs.mkdirSync(archDir, { recursive: true });
    }
  });

  console.log("✅ Build directory prepared");
}

function buildInstaller(architecture) {
  console.log(`🔨 Building installer for ${architecture}...`);

  try {
    // Create architecture-specific NSIS script
    const archScript = path.join(
      CONFIG.buildDir,
      architecture,
      "gmgmt-installer.nsi",
    );
    let scriptContent = fs.readFileSync(CONFIG.nsisScript, "utf8");

    // Replace architecture placeholder
    scriptContent = scriptContent.replace(/\$\{ARCH\}/g, architecture);

    // Write architecture-specific script
    fs.writeFileSync(archScript, scriptContent);

    // Build installer
    const outputFile = path.join(
      CONFIG.buildDir,
      architecture,
      `${CONFIG.projectName}-Setup-${architecture}.exe`,
    );
    const command = `makensis "${archScript}"`;

    console.log(`   Running: ${command}`);
    execSync(command, { stdio: "inherit", cwd: process.cwd() });

    // Check if installer was created
    if (fs.existsSync(outputFile)) {
      const stats = fs.statSync(outputFile);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`✅ Installer created: ${outputFile} (${sizeMB} MB)`);
      return outputFile;
    } else {
      throw new Error("Installer file not found after build");
    }
  } catch (error) {
    console.error(
      `❌ Failed to build installer for ${architecture}:`,
      error.message,
    );
    throw error;
  }
}

function buildAllInstallers() {
  console.log("🚀 Starting installer build process...");

  const targetArchs =
    options.arch === "both" ? CONFIG.architectures : [options.arch];
  const createdInstallers = [];

  for (const arch of targetArchs) {
    try {
      const installerPath = buildInstaller(arch);
      createdInstallers.push(installerPath);
    } catch (error) {
      console.error(`❌ Build failed for ${arch}`);
      if (targetArchs.length === 1) {
        process.exit(1);
      }
    }
  }

  return createdInstallers;
}

function showBuildSummary(installers) {
  console.log("\n🎉 Build Summary:");
  console.log("================");

  installers.forEach((installer) => {
    const stats = fs.statSync(installer);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`✅ ${path.basename(installer)} (${sizeMB} MB)`);
  });

  console.log("\n📋 Next Steps:");
  console.log("1. Test installers on clean Windows systems");
  console.log("2. Verify Windows Service installation");
  console.log("3. Test application functionality");
  console.log("4. Distribute installers to end users");

  console.log("\n💡 Testing Commands:");
  console.log("   # Install service");
  console.log("   npm run service:install");
  console.log("   # Check status");
  console.log("   npm run service:status");
  console.log("   # Access application");
  console.log("   # http://localhost:3001");
}

// Main execution
async function main() {
  try {
    if (options.help) {
      showHelp();
      return;
    }

    console.log("🔨 GMgmt Windows Installer Build Script");
    console.log("========================================");

    checkRequirements();
    cleanBuildDirectory();
    prepareBuildDirectory();

    const installers = buildAllInstallers();
    showBuildSummary(installers);
  } catch (error) {
    console.error("❌ Build failed:", error.message);
    process.exit(1);
  }
}

// Run the script
main();
