#!/usr/bin/env node

/**
 * ESP32 Webhook Test Script
 * Tests the HTTP webhook endpoint that ESP32 devices use to send data
 */

const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Configuration - Use environment variables with fallbacks
const API_PORT = process.env.PORT || 3001;
const BIOMETRIC_PORT = process.env.BIOMETRIC_PORT || 8080;
const API_BASE_URL = `http://localhost:${API_PORT}/api/biometric`;

console.log('🧪 ESP32 Webhook Test Script');
console.log('=============================');
console.log(`Target API: ${API_BASE_URL}`);
console.log(`Biometric Listener Port: ${BIOMETRIC_PORT}`);
console.log(`Main Server Port: ${API_PORT}`);
console.log('');

// Test data that ESP32 would send
const heartbeatData = {
  deviceId: 'DOOR_TEST_001',
  deviceType: 'esp32_door_lock',
  status: 'ready',
  timestamp: new Date().toISOString(),
  event: 'heartbeat',
  wifi_rssi: -45,
  free_heap: 200000,
  enrolled_prints: 5,
  ip_address: '192.168.1.100'
};

const fingerprintData = {
  userId: '123',
  memberId: '123',
  timestamp: new Date().toISOString(),
  status: 'authorized',
  deviceId: 'DOOR_TEST_001',
  event: 'TimeLog',
  verifMode: 'FP',
  deviceType: 'esp32_door_lock',
  location: 'main_entrance'
};

// Helper function to make HTTP requests
function makeRequest(endpoint, method = 'POST', data = null) {
  return new Promise((resolve, reject) => {
    // Fix URL construction to properly handle relative endpoints
    let fullUrl;
    if (endpoint.startsWith('/')) {
      // If endpoint starts with /, append it to the base URL
      fullUrl = API_BASE_URL + endpoint;
    } else {
      // Otherwise, use the URL constructor
      fullUrl = new URL(endpoint, API_BASE_URL).toString();
    }
    
    const url = new URL(fullUrl);
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ESP32-Test/1.0'
      }
    };

    console.log(`🌐 Making ${method} request to: ${url.toString()}`);
    if (data) {
      console.log(`📤 Request data: ${JSON.stringify(data, null, 2)}`);
    }

    const req = http.request(url, options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        console.log(`📡 Response headers:`, res.headers);
        
        try {
          const parsedData = JSON.parse(responseData);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: parsedData
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: responseData
          });
        }
      });
    });

    req.on('error', (error) => {
      console.log(`❌ Request error: ${error.message}`);
      reject(error);
    });

    if (data && method !== 'GET') {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Test 0: Check server health
async function testServerHealth() {
  console.log('🏥 Testing server health...');
  
  try {
    const response = await makeRequest('/status', 'GET');
    
    console.log(`📡 Response Status: ${response.statusCode}`);
    
    if (response.statusCode === 200) {
      if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
        console.log('⚠️  Server is running but returning HTML instead of JSON');
        console.log('   This usually means the API routes are not properly configured');
        return false;
      } else {
        console.log('✅ Server is healthy and returning JSON data');
        return true;
      }
    } else {
      console.log('❌ Server health check failed');
      return false;
    }
  } catch (error) {
    console.log('❌ Server health check error:', error.message);
    return false;
  }
}

// Test 1: Send heartbeat to webhook
async function testHeartbeat() {
  console.log('💓 Testing ESP32 heartbeat webhook...');
  
  try {
    const response = await makeRequest('/esp32-webhook', 'POST', heartbeatData);
    
    console.log(`📡 Response Status: ${response.statusCode}`);
    console.log('📤 Response Data:', JSON.stringify(response.data, null, 2));
    
    if (response.statusCode === 200) {
      console.log('✅ Heartbeat webhook test PASSED');
      return true;
    } else {
      console.log('❌ Heartbeat webhook test FAILED');
      return false;
    }
  } catch (error) {
    console.log('❌ Heartbeat webhook test ERROR:', error.message);
    return false;
  }
}

// Test 2: Send fingerprint authentication to webhook
async function testFingerprint() {
  console.log('\n👆 Testing ESP32 fingerprint authentication webhook...');
  
  try {
    const response = await makeRequest('/esp32-webhook', 'POST', fingerprintData);
    
    console.log(`📡 Response Status: ${response.statusCode}`);
    console.log('📤 Response Data:', JSON.stringify(response.data, null, 2));
    
    if (response.statusCode === 200) {
      console.log('✅ Fingerprint webhook test PASSED');
      return true;
    } else {
      console.log('❌ Fingerprint webhook test FAILED');
      return false;
    }
  } catch (error) {
    console.log('❌ Fingerprint webhook test ERROR:', error.message);
    return false;
  }
}

// Test 3: Check system status
async function testSystemStatus() {
  console.log('\n📊 Testing system status endpoint...');
  
  try {
    const response = await makeRequest('/status', 'GET');
    
    console.log(`📡 Response Status: ${response.statusCode}`);
    console.log('📤 Response Data:', JSON.stringify(response.data, null, 2));
    
    if (response.statusCode === 200) {
      console.log('✅ System status test PASSED');
      
      // Check if our test device is showing up
      if (response.data.connectedDevices > 0) {
        console.log(`✅ Found ${response.data.connectedDevices} connected device(s)`);
      } else {
        console.log('⚠️  No connected devices found - this might be the issue!');
      }
      
      return true;
    } else {
      console.log('❌ System status test FAILED');
      return false;
    }
  } catch (error) {
    console.log('❌ System status test ERROR:', error.message);
    return false;
  }
}

// Test 4: Check biometric events
async function testBiometricEvents() {
  console.log('\n📋 Testing biometric events endpoint...');
  
  try {
    const response = await makeRequest('/events?limit=5', 'GET');
    
    console.log(`📡 Response Status: ${response.statusCode}`);
    console.log('📤 Response Data:', JSON.stringify(response.data, null, 2));
    
    if (response.statusCode === 200) {
      console.log('✅ Biometric events test PASSED');
      
      if (response.data.events && response.data.events.length > 0) {
        console.log(`✅ Found ${response.data.events.length} biometric events`);
        
        // Look for our test device
        const testEvents = response.data.events.filter(event => 
          event.device_id === 'DOOR_TEST_001'
        );
        
        if (testEvents.length > 0) {
          console.log(`✅ Found ${testEvents.length} events from test device`);
        } else {
          console.log('⚠️  No events found from test device');
        }
      } else {
        console.log('⚠️  No biometric events found in database');
      }
      
      return true;
    } else {
      console.log('❌ Biometric events test FAILED');
      return false;
    }
  } catch (error) {
    console.log('❌ Biometric events test ERROR:', error.message);
    return false;
  }
}

// Test 5: Test connection endpoint
async function testConnection() {
  console.log('\n🔗 Testing connection test endpoint...');
  
  try {
    const response = await makeRequest('/test-connection', 'POST', {});
    
    console.log(`📡 Response Status: ${response.statusCode}`);
    console.log('📤 Response Data:', JSON.stringify(response.data, null, 2));
    
    if (response.statusCode === 200) {
      console.log('✅ Connection test PASSED');
      return true;
    } else {
      console.log('❌ Connection test FAILED');
      return false;
    }
  } catch (error) {
    console.log('❌ Connection test ERROR:', error.message);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting ESP32 webhook tests...\n');
  
  const results = {
    serverHealth: false,
    heartbeat: false,
    fingerprint: false,
    systemStatus: false,
    biometricEvents: false,
    connection: false
  };
  
  try {
    // Run tests
    results.serverHealth = await testServerHealth();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    // Only run other tests if server is healthy
    if (results.serverHealth) {
      results.heartbeat = await testHeartbeat();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      results.fingerprint = await testFingerprint();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      results.systemStatus = await testSystemStatus();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      results.biometricEvents = await testBiometricEvents();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      results.connection = await testConnection();
    } else {
      console.log('⚠️  Skipping other tests due to server health issues');
    }
    
  } catch (error) {
    console.error('❌ Test execution error:', error);
  }
  
  // Summary
  console.log('\n📊 Test Results Summary');
  console.log('========================');
  console.log(`🏥 Server Health: ${results.serverHealth ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`💓 Heartbeat Webhook: ${results.heartbeat ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`👆 Fingerprint Webhook: ${results.fingerprint ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`📊 System Status: ${results.systemStatus ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`📋 Biometric Events: ${results.biometricEvents ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`🔗 Connection Test: ${results.connection ? '✅ PASS' : '❌ FAIL'}`);
  
  const passedTests = Object.values(results).filter(Boolean).length;
  const totalTests = Object.keys(results).length;
  
  console.log(`\n🎯 Overall: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! ESP32 webhook is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check the output above for details.');
    
    // Troubleshooting tips
    console.log('\n🔧 Troubleshooting Tips:');
    console.log('1. Make sure the server is running with biometric integration:');
    console.log('   npm run start:with-biometric');
    console.log('   OR: ENABLE_BIOMETRIC=true npm start');
    console.log('');
    console.log('2. Check your .env file has:');
    console.log('   ENABLE_BIOMETRIC=true');
    console.log('   PORT=3001 (or your preferred server port)');
    console.log('   BIOMETRIC_PORT=5005 (or your preferred biometric port)');
    console.log('');
    console.log('3. Verify the biometric_events table exists:');
    console.log('   npm run biometric:setup');
    console.log('');
    console.log('4. Check server logs for biometric integration messages:');
    console.log('   Should see: "🔐 Starting biometric integration..."');
    console.log(`   Should see: "Biometric listener started on 0.0.0.0:${BIOMETRIC_PORT}"`);
    console.log('');
    console.log('5. If server is running but returning HTML instead of JSON:');
    console.log('   The API routes are not properly configured');
    console.log('   Restart the server with biometric integration enabled');
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  testServerHealth,
  testHeartbeat,
  testFingerprint,
  testSystemStatus,
  testBiometricEvents,
  testConnection,
  runTests
};
