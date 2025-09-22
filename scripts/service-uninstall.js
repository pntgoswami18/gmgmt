#!/usr/bin/env node

/**
 * Windows Service Uninstallation Script for GMgmt
 * 
 * This script uninstalls the GMgmt Windows Service.
 * It should be run with administrator privileges.
 * 
 * Usage:
 *   node scripts/service-uninstall.js
 * 
 * Requirements:
 *   - Windows operating system
 *   - Administrator privileges
 *   - node-windows package installed
 */

const path = require('path');

// Check if we're on Windows
if (process.platform !== 'win32') {
  console.error('❌ This script is designed for Windows only.');
  console.error('   Current platform:', process.platform);
  process.exit(1);
}

// Check if node-windows is available
let Service;
try {
  Service = require('node-windows').Service;
} catch (error) {
  console.error('❌ node-windows package not found.');
  console.error('   Please install it first: npm install node-windows --save');
  process.exit(1);
}

console.log('🛑 Uninstalling GMgmt Windows Service...');

// Create the service instance
const svc = new Service({
  name: 'GMgmt',
  script: path.join(__dirname, '..', 'src', 'app.js')
});

// Event handlers
svc.on('uninstall', () => {
  console.log('✅ Service uninstalled successfully!');
  console.log('🗑️  GMgmt Windows Service has been removed');
  console.log('');
  console.log('📋 Next steps:');
  console.log('   - Service files have been cleaned up');
  console.log('   - You can reinstall with: node scripts/service-install.js');
  console.log('   - Or run manually with: npm start');
});

svc.on('error', (err) => {
  console.error('❌ Uninstall error:', err);
  process.exit(1);
});

svc.on('doesnotexist', () => {
  console.log('⚠️  Service does not exist or is not installed.');
  console.log('✅ Nothing to uninstall.');
});

// Uninstall the service
console.log('⏳ Uninstalling service...');
svc.uninstall();
