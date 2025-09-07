#!/usr/bin/env node

/**
 * Utility to calculate timezone offset for ESP32 configuration
 * This helps determine the correct TIMEZONE_OFFSET value for config.h
 */

console.log('🌍 ESP32 Timezone Offset Calculator\n');

// Common timezone offsets (in seconds)
const timezones = {
  'UTC+5:30 (India)': 19800,
  'UTC+5 (Pakistan)': 18000,
  'UTC+4 (UAE)': 14400,
  'UTC+3 (Moscow)': 10800,
  'UTC+2 (Central Europe)': 7200,
  'UTC+1 (UK)': 3600,
  'UTC+0 (UTC)': 0,
  'UTC-1 (Azores)': -3600,
  'UTC-2 (Mid-Atlantic)': -7200,
  'UTC-3 (Brazil)': -10800,
  'UTC-4 (Eastern South America)': -14400,
  'UTC-5 (Eastern US)': -18000,
  'UTC-6 (Central US)': -21600,
  'UTC-7 (Mountain US)': -25200,
  'UTC-8 (Pacific US)': -28800,
  'UTC-9 (Alaska)': -32400,
  'UTC-10 (Hawaii)': -36000,
  'UTC+7 (Thailand)': 25200,
  'UTC+8 (China)': 28800,
  'UTC+9 (Japan)': 32400,
  'UTC+10 (Australia East)': 36000,
  'UTC+11 (Australia Central)': 39600,
  'UTC+12 (New Zealand)': 43200
};

console.log('📋 Available timezone offsets:\n');

Object.entries(timezones).forEach(([name, offset]) => {
  const sign = offset >= 0 ? '+' : '';
  const hours = Math.abs(offset) / 3600;
  const minutes = (Math.abs(offset) % 3600) / 60;
  
  let timeStr = `UTC${sign}${hours}`;
  if (minutes > 0) {
    timeStr += `:${minutes.toString().padStart(2, '0')}`;
  }
  
  console.log(`${name.padEnd(25)} | ${timeStr.padStart(8)} | ${offset.toString().padStart(6)} seconds`);
});

console.log('\n🔧 To configure your ESP32:');
console.log('1. Find your timezone from the list above');
console.log('2. Copy the offset value (in seconds)');
console.log('3. Update esp32_door_lock/config.h:');
console.log('   #define TIMEZONE_OFFSET <your_offset>');

console.log('\n💡 Example for India:');
console.log('   #define TIMEZONE_OFFSET 19800');

console.log('\n💡 Example for Eastern US:');
console.log('   #define TIMEZONE_OFFSET -18000');

console.log('\n⚠️  Note:');
console.log('- Positive values = ahead of UTC');
console.log('- Negative values = behind UTC');
console.log('- After updating, recompile and upload to ESP32');
console.log('- Restart the ESP32 device for changes to take effect');

// Interactive mode
console.log('\n🎯 Interactive Mode:');
console.log('Enter your timezone (e.g., "India", "Eastern US", "UTC+8"):');

process.stdin.once('data', (data) => {
  const input = data.toString().trim();
  
  // Find matching timezone
  const match = Object.entries(timezones).find(([name, offset]) => 
    name.toLowerCase().includes(input.toLowerCase()) || 
    name.includes(input)
  );
  
  if (match) {
    const [name, offset] = match;
    console.log(`\n✅ Found: ${name}`);
    console.log(`📝 Add this to esp32_door_lock/config.h:`);
    console.log(`   #define TIMEZONE_OFFSET ${offset}`);
  } else {
    console.log(`\n❌ No exact match found for "${input}"`);
    console.log('Please check the list above and use the exact name or offset value.');
  }
  
  process.exit(0);
});
