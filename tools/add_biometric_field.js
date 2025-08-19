#!/usr/bin/env node

/**
 * Database migration script to add biometric_id field to members table
 * Run this script to prepare your database for biometric integration
 */

const path = require('path');
const Database = require('better-sqlite3');

// Get database path using same logic as main app
const dataRoot = process.env.WIN_DATA_ROOT || (process.platform === 'win32'
  ? path.join(process.env.ProgramData || 'C:/ProgramData', 'gmgmt')
  : path.join(process.cwd(), 'data'));

const dbPath = path.join(dataRoot, 'data', 'gmgmt.sqlite');

console.log('🔧 Adding biometric_id field to members table...');
console.log(`📂 Database path: ${dbPath}`);

// Check if --help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Database Migration for Biometric Integration');
    console.log('');
    console.log('Usage: node add_biometric_field.js');
    console.log('');
    console.log('This script will:');
    console.log('- Add biometric_id column to members table');
    console.log('- Create security_logs table');
    console.log('- Create biometric_events table');
    console.log('- Add performance indexes');
    console.log('- Add date field to attendance table if missing');
    console.log('');
    console.log('Make sure to backup your database before running this migration!');
    process.exit(0);
}

try {
    const db = new Database(dbPath);
    console.log('✅ Connected to SQLite database');

    // Check if biometric_id column already exists
    const checkColumnExists = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
        return columns.some(col => col.name === columnName);
    };

    // Add biometric_id column to members table if it doesn't exist
    if (!checkColumnExists('members', 'biometric_id')) {
        console.log('➕ Adding biometric_id column to members table...');
        db.prepare('ALTER TABLE members ADD COLUMN biometric_id TEXT').run();
        console.log('✅ biometric_id column added successfully');
    } else {
        console.log('✅ biometric_id column already exists in members table');
    }

    // Add date column to attendance table if it doesn't exist
    if (!checkColumnExists('attendance', 'date')) {
        console.log('➕ Adding date column to attendance table...');
        db.prepare('ALTER TABLE attendance ADD COLUMN date TEXT').run();
        
        // Update existing records with date from check_in_time
        db.prepare(`
            UPDATE attendance 
            SET date = date(check_in_time) 
            WHERE date IS NULL AND check_in_time IS NOT NULL
        `).run();
        
        console.log('✅ date column added to attendance table');
    } else {
        console.log('✅ date column already exists in attendance table');
    }

    // Create security_logs table
    console.log('📊 Creating security_logs table...');
    db.prepare(`
        CREATE TABLE IF NOT EXISTS security_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            details TEXT,
            member_id INTEGER,
            device_id TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (member_id) REFERENCES members (id)
        )
    `).run();
    console.log('✅ security_logs table ready');

    // Create biometric_events table
    console.log('📊 Creating biometric_events table...');
    db.prepare(`
        CREATE TABLE IF NOT EXISTS biometric_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER,
            biometric_id TEXT,
            event_type TEXT NOT NULL,
            device_id TEXT,
            timestamp TEXT NOT NULL,
            success BOOLEAN NOT NULL,
            error_message TEXT,
            raw_data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (member_id) REFERENCES members (id)
        )
    `).run();
    console.log('✅ biometric_events table ready');

    // Add indexes for better performance
    console.log('🚀 Adding database indexes...');
    const indexes = [
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_members_biometric_id ON members(biometric_id) WHERE biometric_id IS NOT NULL',
        'CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_member_date ON attendance(member_id, date)',
        'CREATE INDEX IF NOT EXISTS idx_security_logs_timestamp ON security_logs(timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_security_logs_event_type ON security_logs(event_type)',
        'CREATE INDEX IF NOT EXISTS idx_biometric_events_timestamp ON biometric_events(timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_biometric_events_member_id ON biometric_events(member_id)',
        'CREATE INDEX IF NOT EXISTS idx_biometric_events_biometric_id ON biometric_events(biometric_id)'
    ];

    for (const indexSql of indexes) {
        try {
            db.prepare(indexSql).run();
        } catch (error) {
            console.warn(`⚠️  Warning creating index: ${error.message}`);
        }
    }
    console.log('✅ Database indexes added');

    // Migrate existing member_biometrics data if any
    console.log('🔄 Checking for existing biometric data to migrate...');
    const existingBiometrics = db.prepare('SELECT * FROM member_biometrics').all();
    
    if (existingBiometrics.length > 0) {
        console.log(`📋 Found ${existingBiometrics.length} existing biometric records to migrate...`);
        
        for (const biometric of existingBiometrics) {
            try {
                // Update member with biometric_id from device_user_id
                db.prepare('UPDATE members SET biometric_id = ? WHERE id = ?')
                  .run(biometric.device_user_id, biometric.member_id);
                
                // Log migration event
                db.prepare(`
                    INSERT INTO biometric_events (
                        member_id, biometric_id, event_type, device_id, 
                        timestamp, success, raw_data
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(
                    biometric.member_id,
                    biometric.device_user_id,
                    'migration',
                    'migration_script',
                    new Date().toISOString(),
                    1,
                    JSON.stringify({ migrated_from: 'member_biometrics', original_id: biometric.id })
                );
                
                console.log(`✅ Migrated biometric data for member ${biometric.member_id}`);
            } catch (error) {
                console.warn(`⚠️  Warning migrating biometric for member ${biometric.member_id}: ${error.message}`);
            }
        }
    } else {
        console.log('ℹ️  No existing biometric data found to migrate');
    }

    db.close();
    console.log('📂 Database connection closed');

    console.log('');
    console.log('🎉 Database migration completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Create a .env file with: ENABLE_BIOMETRIC=true');
    console.log('2. Configure your SecureEye device to send data to your server');
    console.log('3. Start the biometric integration: npm run start:with-biometric');
    console.log('4. Go to the Biometric section in your admin dashboard');
    console.log('5. Enroll member fingerprints using the enrollment interface');
    console.log('');
    console.log('🔧 Test commands:');
    console.log('  npm run biometric:check   # Check if service is running');
    console.log('  npm run biometric:test    # Send test messages');
    console.log('');

} catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
}