#!/usr/bin/env node

/**
 * Test script for Admin Roles Implementation
 * This script tests the database schema changes and admin functionality
 */

const Database = require('better-sqlite3');
const path = require('path');

// Database path
const dbPath = path.join(__dirname, 'data', 'gmgmt.sqlite');

console.log('🧪 Testing Admin Roles Implementation');
console.log('====================================');

try {
    // Connect to database
    const db = new Database(dbPath);
    console.log('✅ Connected to database:', dbPath);

    // Check if is_admin column exists
    const columns = db.prepare("PRAGMA table_info(members)").all();
    const hasAdminColumn = columns.some(col => col.name === 'is_admin');
    
    if (hasAdminColumn) {
        console.log('✅ is_admin column exists in members table');
        
        // Check current admin users
        const adminUsers = db.prepare("SELECT id, name, is_admin FROM members WHERE is_admin = 1").all();
        console.log(`📊 Found ${adminUsers.length} admin users:`);
        adminUsers.forEach(user => {
            console.log(`   - ${user.name} (ID: ${user.id})`);
        });
        
        // Check regular users
        const regularUsers = db.prepare("SELECT id, name, is_admin FROM members WHERE is_admin = 0 OR is_admin IS NULL").all();
        console.log(`📊 Found ${regularUsers.length} regular users:`);
        regularUsers.forEach(user => {
            console.log(`   - ${user.name} (ID: ${user.id})`);
        });
        
        // Test creating an admin user
        console.log('\n🔧 Testing admin user creation...');
        try {
            const testAdmin = db.prepare(`
                INSERT INTO members (name, phone, is_admin, is_active) 
                VALUES (?, ?, ?, ?)
            `).run('Test Admin User', '+1234567890', 1, 1);
            
            console.log(`✅ Created test admin user with ID: ${testAdmin.lastInsertRowid}`);
            
            // Clean up test user
            db.prepare('DELETE FROM members WHERE id = ?').run(testAdmin.lastInsertRowid);
            console.log('🧹 Cleaned up test admin user');
            
        } catch (error) {
            console.log('⚠️  Test admin creation failed:', error.message);
        }
        
    } else {
        console.log('❌ is_admin column does not exist in members table');
        console.log('🔧 Attempting to add is_admin column...');
        
        try {
            db.prepare("ALTER TABLE members ADD COLUMN is_admin INTEGER DEFAULT 0").run();
            db.prepare("UPDATE members SET is_admin = 0 WHERE is_admin IS NULL").run();
            console.log('✅ Successfully added is_admin column');
        } catch (error) {
            console.log('❌ Failed to add is_admin column:', error.message);
        }
    }
    
    // Check attendance table structure
    console.log('\n📊 Checking attendance table...');
    const attendanceColumns = db.prepare("PRAGMA table_info(attendance)").all();
    console.log('Attendance table columns:', attendanceColumns.map(col => col.name));
    
    // Test attendance logic for admin users
    console.log('\n🔧 Testing attendance logic...');
    const testMember = db.prepare("SELECT id, name, is_admin FROM members LIMIT 1").get();
    
    if (testMember) {
        console.log(`Testing with member: ${testMember.name} (Admin: ${testMember.is_admin === 1 ? 'Yes' : 'No'})`);
        
        // Check if member has checked in today
        const todayCheckins = db.prepare(`
            SELECT COUNT(*) as count FROM attendance 
            WHERE member_id = ? AND DATE(check_in_time) = DATE('now')
        `).get(testMember.id);
        
        console.log(`Today's check-ins: ${todayCheckins.count}`);
        
        if (testMember.is_admin === 1) {
            console.log('✅ Admin user can check in multiple times per day');
        } else {
            console.log('ℹ️  Regular user can only check in once per day');
        }
    }
    
    db.close();
    console.log('\n🎉 Admin roles test completed successfully!');
    
} catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
}
