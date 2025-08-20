#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

// Load environment variables from .env if it exists
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
    // dotenv not available, skip loading
}

// Get command line argument (default to 'check')
const command = process.argv[2] || 'check';

// Determine which script to run based on platform
const isWindows = os.platform() === 'win32';
const scriptName = isWindows ? 'test_biometric.bat' : 'test_biometric.sh';
const scriptPath = path.join(__dirname, scriptName);

// Set up the command to run
let cmd, args;
if (isWindows) {
    cmd = 'cmd';
    args = ['/c', scriptPath, command];
} else {
    cmd = 'bash';
    args = [scriptPath, command];
}

// Run the appropriate script
const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env }
});

child.on('close', (code) => {
    process.exit(code);
});

child.on('error', (error) => {
    console.error(`Error running biometric test: ${error.message}`);
    process.exit(1);
});
