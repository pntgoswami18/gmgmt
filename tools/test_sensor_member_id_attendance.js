#!/usr/bin/env node

/**
 * Test script to simulate sensor member ID based attendance tracking
 * This demonstrates how the system now uses sensor member IDs for attendance
 */

const net = require('net');

// Configuration
const BIOMETRIC_HOST = 'localhost';
const BIOMETRIC_PORT = 5005;

console.log('🧪 Sensor Member ID Attendance Test Script');
console.log('==========================================');

// Test scenarios with different ID combinations
const testScenarios = [
  {
    name: 'Scenario 1: Different sensor member ID and device user ID',
    data: {
      userId: '4',           // Device assigned this user ID
      memberId: '12345',     // Sensor sends this member ID
      timestamp: new Date().toISOString(),
      status: 'authorized',
      deviceId: 'DEVICE001'
    },
    description: 'Member has device user ID "4" but sensor sends member ID "12345"'
  },
  {
    name: 'Scenario 2: Same sensor member ID and device user ID',
    data: {
      userId: '7',
      memberId: '7',
      timestamp: new Date().toISOString(),
      status: 'authorized',
      deviceId: 'DEVICE001'
    },
    description: 'Member has matching device user ID and sensor member ID'
  },
  {
    name: 'Scenario 3: Only device user ID (legacy behavior)',
    data: {
      userId: '9',
      timestamp: new Date().toISOString(),
      status: 'authorized',
      deviceId: 'DEVICE001'
    },
    description: 'Old device format - only sends user ID, no separate member ID'
  },
  {
    name: 'Scenario 4: XML format with separate member ID',
    xmlData: `<?xml version="1.0" encoding="UTF-8"?>
<Message>
  <DeviceUID>DEVICE001</DeviceUID>
  <UserID>6</UserID>
  <MemberID>54321</MemberID>
  <Event>TimeLog</Event>
  <VerifMode>FP</VerifMode>
  <AttendStat>CheckIn</AttendStat>
  <Year>2024</Year>
  <Month>12</Month>
  <Day>21</Day>
  <Hour>10</Hour>
  <Minute>30</Minute>
  <Second>15</Second>
</Message>`,
    description: 'XML format with UserID "6" and MemberID "54321"'
  }
];

async function runTest(scenario, index) {
  return new Promise((resolve, reject) => {
    console.log(`\n${index + 1}. ${scenario.name}`);
    console.log(`   ${scenario.description}`);
    
    const client = new net.Socket();
    
    client.connect(BIOMETRIC_PORT, BIOMETRIC_HOST, () => {
      console.log(`   ✅ Connected to biometric service`);
      
      // Send test data
      const testData = scenario.xmlData || JSON.stringify(scenario.data);
      console.log(`   📤 Sending: ${testData.substring(0, 100)}${testData.length > 100 ? '...' : ''}`);
      
      client.write(testData);
      
      // Close connection after a brief delay
      setTimeout(() => {
        client.end();
        resolve();
      }, 1000);
    });

    client.on('data', (data) => {
      console.log(`   📥 Response: ${data.toString()}`);
    });

    client.on('close', () => {
      console.log(`   🔌 Connection closed`);
    });

    client.on('error', (err) => {
      console.log(`   ❌ Connection error: ${err.message}`);
      resolve(); // Continue with other tests
    });
  });
}

async function runAllTests() {
  console.log('\n🚀 Starting attendance tracking tests...\n');
  
  for (let i = 0; i < testScenarios.length; i++) {
    await runTest(testScenarios[i], i);
    
    // Wait between tests
    if (i < testScenarios.length - 1) {
      console.log('\n   ⏱️  Waiting 2 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n✅ All tests completed!');
  console.log('\n📋 Expected Results:');
  console.log('   • Check server logs for member identification details');
  console.log('   • Scenario 1: Should find member by sensor member ID "12345"');
  console.log('   • Scenario 2: Should find member by either ID (both same)');
  console.log('   • Scenario 3: Should find member by device user ID "9"');
  console.log('   • Scenario 4: Should find member by sensor member ID "54321"');
  console.log('\n💡 Tip: Run this with biometric service running to see actual results');
}

// Check if --help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('\nUsage: node test_sensor_member_id_attendance.js');
  console.log('\nThis script tests the sensor member ID attendance tracking by sending');
  console.log('simulated biometric data to the running biometric service.');
  console.log('\nMake sure to:');
  console.log('1. Start your gym management system with biometric service enabled');
  console.log('2. Have members enrolled with different ID combinations');
  console.log('3. Check the server logs to see identification methods used');
  console.log('\nTest scenarios:');
  testScenarios.forEach((scenario, index) => {
    console.log(`${index + 1}. ${scenario.description}`);
  });
  process.exit(0);
}

// Run the tests
runAllTests().catch(console.error);
