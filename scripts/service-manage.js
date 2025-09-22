#!/usr/bin/env node

/**
 * Windows Service Management Script for GMgmt
 * 
 * This script provides easy commands to manage the GMgmt Windows Service.
 * 
 * Usage:
 *   node scripts/service-manage.js <command>
 * 
 * Commands:
 *   install   - Install the service
 *   uninstall - Uninstall the service
 *   start     - Start the service
 *   stop      - Stop the service
 *   restart   - Restart the service
 *   status    - Check service status
 * 
 * Requirements:
 *   - Windows operating system
 *   - Administrator privileges for install/uninstall
 *   - node-windows package installed
 */

const path = require('path');
const { execSync } = require('child_process');

// Check if we're on Windows
if (process.platform !== 'win32') {
  console.error('❌ This script is designed for Windows only.');
  console.error('   Current platform:', process.platform);
  process.exit(1);
}

// Get command from arguments
const command = process.argv[2];

if (!command) {
  console.log('🔧 GMgmt Windows Service Manager');
  console.log('');
  console.log('Usage: node scripts/service-manage.js <command>');
  console.log('');
  console.log('Commands:');
  console.log('  install   - Install the service');
  console.log('  uninstall - Uninstall the service');
  console.log('  start     - Start the service');
  console.log('  stop      - Stop the service');
  console.log('  restart   - Restart the service');
  console.log('  status    - Check service status');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/service-manage.js install');
  console.log('  node scripts/service-manage.js status');
  process.exit(0);
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

// Create service instance
const svc = new Service({
  name: 'GMgmt',
  script: path.join(__dirname, '..', 'src', 'app.js'),
  workingDirectory: path.join(__dirname, '..'),
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT', value: '3001' }
  ]
});

// Command handlers
switch (command.toLowerCase()) {
  case 'install':
    console.log('🚀 Installing GMgmt Windows Service...');
    svc.on('install', () => {
      console.log('✅ Service installed successfully!');
      svc.start();
    });
    svc.on('start', () => {
      console.log('✅ Service started successfully!');
      console.log('🌐 Access GMgmt at: http://localhost:3001');
    });
    svc.on('error', (err) => {
      console.error('❌ Installation error:', err);
      process.exit(1);
    });
    svc.install();
    break;

  case 'uninstall':
    console.log('🛑 Uninstalling GMgmt Windows Service...');
    svc.on('uninstall', () => {
      console.log('✅ Service uninstalled successfully!');
    });
    svc.on('error', (err) => {
      console.error('❌ Uninstall error:', err);
      process.exit(1);
    });
    svc.uninstall();
    break;

  case 'start':
    console.log('▶️  Starting GMgmt Windows Service...');
    try {
      execSync('net start GMgmt', { stdio: 'inherit' });
      console.log('✅ Service started successfully!');
    } catch (error) {
      console.error('❌ Failed to start service:', error.message);
      process.exit(1);
    }
    break;

  case 'stop':
    console.log('⏹️  Stopping GMgmt Windows Service...');
    try {
      execSync('net stop GMgmt', { stdio: 'inherit' });
      console.log('✅ Service stopped successfully!');
    } catch (error) {
      console.error('❌ Failed to stop service:', error.message);
      process.exit(1);
    }
    break;

  case 'restart':
    console.log('🔄 Restarting GMgmt Windows Service...');
    try {
      execSync('net stop GMgmt', { stdio: 'inherit' });
      console.log('⏹️  Service stopped');
      execSync('net start GMgmt', { stdio: 'inherit' });
      console.log('▶️  Service started');
      console.log('✅ Service restarted successfully!');
    } catch (error) {
      console.error('❌ Failed to restart service:', error.message);
      process.exit(1);
    }
    break;

  case 'status':
    console.log('📊 Checking GMgmt Windows Service status...');
    try {
      const output = execSync('sc query GMgmt', { encoding: 'utf8' });
      console.log('Service Status:');
      console.log(output);
      
      // Check if service is running
      if (output.includes('RUNNING')) {
        console.log('✅ GMgmt service is running');
        console.log('🌐 Access the application at: http://localhost:3001');
      } else if (output.includes('STOPPED')) {
        console.log('⏹️  GMgmt service is stopped');
        console.log('💡 Start it with: node scripts/service-manage.js start');
      } else {
        console.log('❓ Service status unclear');
      }
    } catch (error) {
      console.error('❌ Failed to check service status:', error.message);
      console.log('💡 The service may not be installed');
      console.log('   Install it with: node scripts/service-manage.js install');
    }
    break;

  default:
    console.error(`❌ Unknown command: ${command}`);
    console.log('💡 Available commands: install, uninstall, start, stop, restart, status');
    process.exit(1);
}
