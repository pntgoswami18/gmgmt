#!/usr/bin/env node

/**
 * ESP32 Door Lock Integration Test Script
 * Tests communication between ESP32 devices and gym management system
 */

const net = require('net');
const http = require('http');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Configuration from environment variables
const GYM_SERVER_HOST = process.env.BIOMETRIC_HOST || 'localhost';
const GYM_SERVER_PORT = process.env.BIOMETRIC_PORT || 8080;
const API_PORT = process.env.PORT || 3001;
const API_BASE_URL = `http://localhost:${API_PORT}/api/biometric`;

// Test device data
const TEST_DEVICE_ID = 'DOOR_TEST_001';
const TEST_MEMBER_ID = '123';

console.log('🧪 ESP32 Door Lock Integration Test');
console.log('=====================================');

// Test 1: TCP Connection to Biometric Listener
async function testTCPConnection() {
  return new Promise((resolve, reject) => {
    console.log(`\n📡 Testing TCP connection to ${GYM_SERVER_HOST}:${GYM_SERVER_PORT}`);
    
    const client = new net.Socket();
    
    client.connect(GYM_SERVER_PORT, GYM_SERVER_HOST, () => {
      console.log('✅ TCP connection established');
      client.destroy();
      resolve(true);
    });
    
    client.on('error', (err) => {
      console.log('❌ TCP connection failed:', err.message);
      reject(err);
    });
    
    client.setTimeout(5000, () => {
      console.log('❌ TCP connection timeout');
      client.destroy();
      reject(new Error('Connection timeout'));
    });
  });
}

// Test 2: Send Fingerprint Authentication Message
async function testFingerprintMessage() {
  return new Promise((resolve, reject) => {
    console.log('\n👆 Testing fingerprint authentication message');
    
    const client = new net.Socket();
    
    const testMessage = {
      userId: TEST_MEMBER_ID,
      memberId: TEST_MEMBER_ID,
      timestamp: new Date().toISOString(),
      status: 'authorized',
      deviceId: TEST_DEVICE_ID,
      event: 'TimeLog',
      verifMode: 'FP',
      deviceType: 'esp32_door_lock',
      location: 'test_entrance'
    };
    
    client.connect(GYM_SERVER_PORT, GYM_SERVER_HOST, () => {
      const jsonMessage = JSON.stringify(testMessage) + '\n';
      console.log('📤 Sending message:', JSON.stringify(testMessage, null, 2));
      client.write(jsonMessage);
      
      setTimeout(() => {
        console.log('✅ Fingerprint message sent successfully');
        client.destroy();
        resolve(true);
      }, 1000);
    });
    
    client.on('error', (err) => {
      console.log('❌ Failed to send fingerprint message:', err.message);
      reject(err);
    });
  });
}

// Test 3: Send Heartbeat Message
async function testHeartbeatMessage() {
  return new Promise((resolve, reject) => {
    console.log('\n💓 Testing heartbeat message');
    
    const client = new net.Socket();
    
    const heartbeatMessage = {
      deviceId: TEST_DEVICE_ID,
      deviceType: 'esp32_door_lock',
      status: 'online',
      timestamp: new Date().toISOString(),
      event: 'heartbeat',
      wifi_rssi: -45,
      free_heap: 200000,
      enrolled_prints: 5
    };
    
    client.connect(GYM_SERVER_PORT, GYM_SERVER_HOST, () => {
      const jsonMessage = JSON.stringify(heartbeatMessage) + '\n';
      console.log('📤 Sending heartbeat:', JSON.stringify(heartbeatMessage, null, 2));
      client.write(jsonMessage);
      
      setTimeout(() => {
        console.log('✅ Heartbeat message sent successfully');
        client.destroy();
        resolve(true);
      }, 1000);
    });
    
    client.on('error', (err) => {
      console.log('❌ Failed to send heartbeat message:', err.message);
      reject(err);
    });
  });
}

// Test 4: Test API Endpoints
async function testAPIEndpoints() {
  console.log('\n🌐 Testing API endpoints');
  
  try {
    // Test device list endpoint
    const devicesResponse = await makeAPIRequest('/devices');
    console.log('✅ GET /devices endpoint working');
    
    // Test device status endpoint
    const statusResponse = await makeAPIRequest(`/devices/${TEST_DEVICE_ID}/status`);
    console.log('✅ GET /devices/:id/status endpoint working');
    
    // Test remote unlock endpoint
    const unlockResponse = await makeAPIRequest(`/devices/${TEST_DEVICE_ID}/unlock`, 'POST', {
      reason: 'test_unlock'
    });
    console.log('✅ POST /devices/:id/unlock endpoint working');
    
  } catch (error) {
    console.log('❌ API endpoint test failed:', error.message);
    throw error;
  }
}

// Helper function to make API requests
function makeAPIRequest(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_BASE_URL);
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(url, options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve(parsedData);
        } catch (e) {
          resolve(responseData);
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (data && method !== 'GET') {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// Test 5: Simulate ESP32 Full Workflow
async function testFullWorkflow() {
  console.log('\n🔄 Testing full ESP32 workflow');
  
  try {
    // 1. Send heartbeat (device comes online)
    await testHeartbeatMessage();
    
    // 2. Simulate fingerprint authentication
    await testFingerprintMessage();
    
    // 3. Send enrollment success message
    const enrollmentMessage = {
      userId: '456',
      memberId: '456',
      timestamp: new Date().toISOString(),
      status: 'enrollment_success',
      deviceId: TEST_DEVICE_ID,
      event: 'Enroll',
      deviceType: 'esp32_door_lock',
      enrollmentStep: 'complete'
    };
    
    await sendMessage(enrollmentMessage, 'Enrollment message');
    
    // 4. Send access denied message
    const deniedMessage = {
      userId: '-1',
      memberId: null,
      timestamp: new Date().toISOString(),
      status: 'unauthorized',
      deviceId: TEST_DEVICE_ID,
      event: 'TimeLog',
      verifMode: 'FP',
      deviceType: 'esp32_door_lock'
    };
    
    await sendMessage(deniedMessage, 'Access denied message');
    
    console.log('✅ Full workflow test completed');
    
  } catch (error) {
    console.log('❌ Full workflow test failed:', error.message);
    throw error;
  }
}

// Helper function to send any message
function sendMessage(message, description) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    
    client.connect(GYM_SERVER_PORT, GYM_SERVER_HOST, () => {
      const jsonMessage = JSON.stringify(message) + '\n';
      console.log(`📤 Sending ${description}`);
      client.write(jsonMessage);
      
      setTimeout(() => {
        console.log(`✅ ${description} sent successfully`);
        client.destroy();
        resolve(true);
      }, 1000);
    });
    
    client.on('error', (err) => {
      console.log(`❌ Failed to send ${description}:`, err.message);
      reject(err);
    });
  });
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting ESP32 integration tests...\n');
  
  // Check system requirements first
  checkSystemRequirements();
  
  // Test network connectivity
  await testNetworkConnectivity();
  
  const tests = [
    { name: 'TCP Connection', fn: testTCPConnection },
    { name: 'Fingerprint Message', fn: testFingerprintMessage },
    { name: 'Heartbeat Message', fn: testHeartbeatMessage },
    { name: 'API Endpoints', fn: testAPIEndpoints },
    { name: 'Full Workflow', fn: testFullWorkflow }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      await test.fn();
      console.log(`✅ ${test.name} - PASSED`);
      passed++;
    } catch (error) {
      console.log(`❌ ${test.name} - FAILED: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n📊 Test Summary');
  console.log('===============');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${(passed / (passed + failed) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! ESP32 integration is working correctly.');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Please check your configuration and try again.');
    process.exit(1);
  }
}

// Test network connectivity (cross-platform)
async function testNetworkConnectivity() {
  console.log('\n🌐 Testing network connectivity');
  
  const platform = os.platform();
  const { execSync } = require('child_process');
  
  try {
    if (platform === 'win32') {
      // Windows ping command
      console.log('🪟 Testing Windows connectivity...');
      execSync(`ping -n 1 ${GYM_SERVER_HOST}`, { stdio: 'ignore', timeout: 5000 });
      
      // Test port connectivity with PowerShell
      const psCommand = `Test-NetConnection -ComputerName ${GYM_SERVER_HOST} -Port ${GYM_SERVER_PORT} -InformationLevel Quiet`;
      try {
        execSync(`powershell -Command "${psCommand}"`, { stdio: 'ignore', timeout: 5000 });
        console.log('✅ Port connectivity test passed');
      } catch (error) {
        console.log('⚠️  PowerShell port test failed, will use TCP test instead');
      }
    } else {
      // Unix-like systems
      console.log('🐧 Testing Unix connectivity...');
      execSync(`ping -c 1 ${GYM_SERVER_HOST}`, { stdio: 'ignore', timeout: 5000 });
      
      // Test port with netcat if available
      try {
        execSync(`nc -z ${GYM_SERVER_HOST} ${GYM_SERVER_PORT}`, { stdio: 'ignore', timeout: 5000 });
        console.log('✅ Port connectivity test passed');
      } catch (error) {
        console.log('⚠️  netcat test failed, will use TCP test instead');
      }
    }
    
    console.log('✅ Basic network connectivity verified');
    return true;
    
  } catch (error) {
    console.log('⚠️  Network connectivity test failed, proceeding with TCP test');
    return false;
  }
}

// Check system requirements
function checkSystemRequirements() {
  const platform = os.platform();
  console.log(`🖥️  Platform: ${platform}`);
  console.log(`🏗️  Architecture: ${os.arch()}`);
  console.log(`📂 Working directory: ${process.cwd()}`);
  
  // Check Node.js version
  const nodeVersion = process.version;
  console.log(`🟢 Node.js version: ${nodeVersion}`);
  
  if (platform === 'win32') {
    console.log('🪟 Windows detected - using Windows-compatible methods');
    
    // Check Windows Firewall recommendations
    console.log('💡 Windows tip: Ensure Windows Firewall allows port', GYM_SERVER_PORT);
    
    // Check if PowerShell is available (should be on modern Windows)
    try {
      const { execSync } = require('child_process');
      execSync('powershell -Command "Get-Host"', { stdio: 'ignore' });
      console.log('⚡ PowerShell available for advanced testing');
    } catch (error) {
      console.log('📝 PowerShell not available');
    }
  } else {
    console.log('🐧 Unix-like system detected');
  }
  
  return true;
}

// Windows-specific debugging info
function showWindowsDebugInfo() {
  if (os.platform() !== 'win32') {
    return;
  }
  
  console.log('\n🪟 Windows-Specific Debug Information');
  console.log('=====================================');
  
  const { execSync } = require('child_process');
  
  try {
    // Show network adapters
    console.log('🔌 Network Adapters:');
    const netAdapters = execSync('powershell -Command "Get-NetAdapter | Select-Object Name, Status | Format-Table -AutoSize"', 
                                { encoding: 'utf8', timeout: 5000 });
    console.log(netAdapters);
  } catch (error) {
    console.log('⚠️  Could not retrieve network adapter info');
  }
  
  try {
    // Show firewall status for the port
    console.log(`🛡️  Firewall Status for Port ${GYM_SERVER_PORT}:`);
    const firewallRules = execSync(`netsh advfirewall firewall show rule name=all | findstr ${GYM_SERVER_PORT}`, 
                                  { encoding: 'utf8', timeout: 5000 });
    if (firewallRules.trim()) {
      console.log(firewallRules);
    } else {
      console.log(`⚠️  No specific firewall rules found for port ${GYM_SERVER_PORT}`);
      console.log('💡 Consider adding firewall rule:');
      console.log(`   netsh advfirewall firewall add rule name="Gym Management Port" dir=in action=allow protocol=TCP localport=${GYM_SERVER_PORT}`);
    }
  } catch (error) {
    console.log('⚠️  Could not check firewall status');
  }
}

// Handle command line arguments
if (process.argv.length > 2) {
  const testName = process.argv[2].toLowerCase();
  
  switch (testName) {
    case 'tcp':
      testTCPConnection().then(() => process.exit(0)).catch(() => process.exit(1));
      break;
    case 'fingerprint':
      testFingerprintMessage().then(() => process.exit(0)).catch(() => process.exit(1));
      break;
    case 'heartbeat':
      testHeartbeatMessage().then(() => process.exit(0)).catch(() => process.exit(1));
      break;
    case 'api':
      testAPIEndpoints().then(() => process.exit(0)).catch(() => process.exit(1));
      break;
    case 'workflow':
      testFullWorkflow().then(() => process.exit(0)).catch(() => process.exit(1));
      break;
    case 'network':
      testNetworkConnectivity().then(() => process.exit(0)).catch(() => process.exit(1));
      break;
    case 'windows':
      if (os.platform() === 'win32') {
        showWindowsDebugInfo();
        process.exit(0);
      } else {
        console.log('❌ Windows debug info only available on Windows systems');
        process.exit(1);
      }
      break;
    case 'system':
      checkSystemRequirements();
      process.exit(0);
      break;
    default:
      console.log('Usage: node test_esp32_integration.js [command]');
      console.log('');
      console.log('Available commands:');
      console.log('  tcp        - Test TCP connection to biometric server');
      console.log('  fingerprint - Test fingerprint authentication message');
      console.log('  heartbeat  - Test device heartbeat message');
      console.log('  api        - Test REST API endpoints');
      console.log('  workflow   - Test complete workflow');
      console.log('  network    - Test network connectivity (cross-platform)');
      console.log('  system     - Check system requirements');
      if (os.platform() === 'win32') {
        console.log('  windows    - Show Windows-specific debug information');
      }
      console.log('');
      console.log('Run without arguments to execute all tests.');
      process.exit(1);
  }
} else {
  // Run all tests if no specific test is specified
  runAllTests();
}
