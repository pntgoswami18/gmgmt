#!/usr/bin/env node

/**
 * Database migration script to add biometric_sensor_member_id field to members table
 * This field will store the member ID received from the biometric sensor, 
 * separate from the existing biometric_id field.
 */

const path = require('path');
const Database = require('better-sqlite3');

// Get database path using same logic as main app
const dataRoot = process.env.WIN_DATA_ROOT || (process.platform === 'win32'
  ? path.join(process.env.ProgramData || 'C:/ProgramData', 'gmgmt')
  : path.join(process.cwd(), 'data'));

const dbPath = path.join(dataRoot, 'data', 'gmgmt.sqlite');

console.log('🔧 Adding biometric_sensor_member_id field to members table...');
console.log(`📂 Database path: ${dbPath}`);

// Check if --help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Database Migration for Biometric Sensor Member ID');
    console.log('');
    console.log('Usage: node add_biometric_sensor_member_id.js');
    console.log('');
    console.log('This script will:');
    console.log('- Add biometric_sensor_member_id column to members table');
    console.log('- This field stores the member ID received from the biometric sensor');
    console.log('- This is separate from the existing biometric_id field');
    console.log('');
    console.log('Make sure to backup your database before running this migration!');
    process.exit(0);
}

try {
    const db = new Database(dbPath);
    console.log('✅ Connected to SQLite database');

    // Check if column already exists
    const checkColumnExists = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
        return columns.some(col => col.name === columnName);
    };

    // Add biometric_sensor_member_id column to members table if it doesn't exist
    if (!checkColumnExists('members', 'biometric_sensor_member_id')) {
        console.log('➕ Adding biometric_sensor_member_id column to members table...');
        db.prepare('ALTER TABLE members ADD COLUMN biometric_sensor_member_id TEXT').run();
        console.log('✅ biometric_sensor_member_id column added successfully');
        
        // Add index for performance
        console.log('🚀 Adding index for biometric_sensor_member_id...');
        db.prepare('CREATE INDEX IF NOT EXISTS idx_members_biometric_sensor_member_id ON members(biometric_sensor_member_id) WHERE biometric_sensor_member_id IS NOT NULL').run();
        console.log('✅ Index added for biometric_sensor_member_id');
    } else {
        console.log('✅ biometric_sensor_member_id column already exists in members table');
    }

    // Update biometric_events table to include sensor_member_id field if it doesn't exist
    if (!checkColumnExists('biometric_events', 'sensor_member_id')) {
        console.log('➕ Adding sensor_member_id column to biometric_events table...');
        db.prepare('ALTER TABLE biometric_events ADD COLUMN sensor_member_id TEXT').run();
        console.log('✅ sensor_member_id column added to biometric_events table');
        
        // Add index for performance
        console.log('🚀 Adding index for sensor_member_id in biometric_events...');
        db.prepare('CREATE INDEX IF NOT EXISTS idx_biometric_events_sensor_member_id ON biometric_events(sensor_member_id) WHERE sensor_member_id IS NOT NULL').run();
        console.log('✅ Index added for sensor_member_id in biometric_events');
    } else {
        console.log('✅ sensor_member_id column already exists in biometric_events table');
    }

    db.close();
    console.log('📂 Database connection closed');

    console.log('');
    console.log('🎉 Database migration completed successfully!');
    console.log('');
    console.log('New fields added:');
    console.log('- members.biometric_sensor_member_id: Stores the member ID from biometric sensor');
    console.log('- biometric_events.sensor_member_id: Logs the sensor member ID in events');
    console.log('');
    console.log('Next steps:');
    console.log('1. Restart your application to pick up the new fields');
    console.log('2. Use the updated enrollment process which will store sensor member IDs');
    console.log('3. The system will now track both internal and sensor member IDs separately');
    console.log('');

} catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
}
