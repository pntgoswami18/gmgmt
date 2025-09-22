#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NODE_VERSION = '18.19.0';
const BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;

const downloads = [
  {
    arch: 'x64',
    filename: `node-v${NODE_VERSION}-win-x64.zip`,
    targetDir: 'vendor/node-win-x64'
  },
  {
    arch: 'x86', 
    filename: `node-v${NODE_VERSION}-win-x86.zip`,
    targetDir: 'vendor/node-win-ia32'
  }
];

function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    console.log(`📥 Downloading ${filename}...`);
    const file = fs.createWriteStream(filename);
    
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`✅ Downloaded ${filename}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filename, () => {}); // Delete the file on error
      reject(err);
    });
  });
}

function extractZip(zipFile, targetDir) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`📦 Extracting ${zipFile}...`);
      
      // Use unzip command (available on macOS/Linux) or PowerShell (Windows)
      let extractCommand;
      if (process.platform === 'win32') {
        extractCommand = `powershell -Command "Expand-Archive -Path '${zipFile}' -DestinationPath '${targetDir}' -Force"`;
      } else {
        extractCommand = `unzip -o "${zipFile}" -d "${targetDir}"`;
      }
      
      execSync(extractCommand, { stdio: 'inherit' });
      
      // Move node.exe to the correct location
      const extractedDir = path.join(targetDir, zipFile.replace('.zip', ''));
      const nodeExe = path.join(extractedDir, 'node.exe');
      const targetExe = path.join(targetDir, 'node.exe');
      
      if (fs.existsSync(nodeExe)) {
        fs.copyFileSync(nodeExe, targetExe);
        console.log(`✅ Extracted node.exe to ${targetDir}`);
        
        // Clean up extracted directory
        if (process.platform === 'win32') {
          execSync(`rmdir /s /q "${extractedDir}"`, { stdio: 'inherit' });
        } else {
          execSync(`rm -rf "${extractedDir}"`, { stdio: 'inherit' });
        }
      }
      
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

async function downloadNodeRuntimes() {
  try {
    console.log(`🚀 Downloading Node.js ${NODE_VERSION} runtimes for Windows...`);
    
    // Create vendor directories
    downloads.forEach(download => {
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
      await extractZip(zipFile, download.targetDir);
      
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
    process.exit(1);
  }
}

// Run the script
downloadNodeRuntimes();
