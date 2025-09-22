#!/usr/bin/env node

/**
 * Windows Service Installation Script for GMgmt
 * 
 * This script installs GMgmt as a Windows Service using node-windows.
 * It should be run with administrator privileges.
 * 
 * Usage:
 *   node scripts/service-install.js
 * 
 * Requirements:
 *   - Windows operating system
 *   - Administrator privileges
 *   - node-windows package installed
 */

const path = require('path');
const fs = require('fs');

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

// Verify the application file exists
const appPath = path.join(__dirname, '..', 'src', 'app.js');
if (!fs.existsSync(appPath)) {
  console.error('❌ Application file not found:', appPath);
  process.exit(1);
}

console.log('🚀 Installing GMgmt as Windows Service...');
console.log('📁 Application path:', appPath);
console.log('📁 Working directory:', path.join(__dirname, '..'));

// Create the service
const svc = new Service({
  name: 'GMgmt',
  description: 'Gym Management Software - Node.js backend service',
  script: appPath,
  workingDirectory: path.join(__dirname, '..'),
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT', value: '3001' }
  ],
  // Additional service configuration
  nodeOptions: [
    '--max-old-space-size=512'
  ],
  // Service recovery options
  wait: 2,
  grow: 0.5,
  maxRestarts: 10
});

// Event handlers
svc.on('install', () => {
  console.log('✅ Service installed successfully!');
  console.log('🔄 Starting service...');
  svc.start();
});

svc.on('start', () => {
  console.log('✅ Service started successfully!');
  console.log('🌐 GMgmt is now running as a Windows Service');
  console.log('📱 Access the application at: http://localhost:3001');
  console.log('');
  console.log('📋 Service Management:');
  console.log('   - View service: services.msc');
  console.log('   - Stop service: net stop GMgmt');
  console.log('   - Start service: net start GMgmt');
  console.log('   - Uninstall: node scripts/service-uninstall.js');
});

svc.on('error', (err) => {
  console.error('❌ Service error:', err);
  process.exit(1);
});

svc.on('alreadyinstalled', () => {
  console.log('⚠️  Service is already installed.');
  console.log('🔄 Attempting to start existing service...');
  svc.start();
});

svc.on('invalidinstallation', () => {
  console.error('❌ Invalid installation detected.');
  console.error('   Please uninstall the service first: node scripts/service-uninstall.js');
  process.exit(1);
});

// Install the service
console.log('⏳ Installing service...');
svc.install();
