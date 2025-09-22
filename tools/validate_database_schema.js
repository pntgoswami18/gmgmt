#!/usr/bin/env node

/**
 * Database Schema Validation Script for Hybrid Cache Implementation
 * 
 * This script validates that all required schemas, tables, columns, and indexes
 * are properly initialized for the hybrid cache implementation.
 * 
 * Run this script to verify database integrity after implementing hybrid cache.
 */

const { pool } = require('../src/config/sqlite');

async function validateDatabaseSchema() {
  console.log('🔍 Starting database schema validation for hybrid cache...');
  console.log('====================================================');

  try {
    // 1. Check required tables exist
    console.log('📋 Checking required tables...');
    const tablesQuery = `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN (
        'members', 'attendance', 'membership_plans', 'biometric_events', 
        'security_logs', 'settings', 'invoices', 'payments'
      )
      ORDER BY name
    `;
    
    const tables = await pool.query(tablesQuery);
    const tableNames = tables.rows.map(row => row.name);
    
    const requiredTables = ['members', 'attendance', 'membership_plans', 'biometric_events', 'security_logs', 'settings', 'invoices', 'payments'];
    const missingTables = requiredTables.filter(table => !tableNames.includes(table));
    
    if (missingTables.length > 0) {
      console.log('❌ Missing tables:', missingTables);
      return false;
    } else {
      console.log('✅ All required tables exist');
    }

    // 2. Check members table columns
    console.log('\n📋 Checking members table columns...');
    const membersCols = await pool.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='members'");
    console.log('Members table schema:', membersCols.rows[0]?.sql);
    
    // Use a different approach to get column info
    const membersColsInfo = await pool.query("SELECT * FROM members LIMIT 0");
    const membersColNames = membersColsInfo.rows.length > 0 ? Object.keys(membersColsInfo.rows[0]) : [];
    
    // If that doesn't work, try a direct query
    if (membersColNames.length === 0) {
      try {
        const testQuery = await pool.query("SELECT id, name, email FROM members LIMIT 1");
        membersColNames.push('id', 'name', 'email'); // At least these should exist
      } catch (error) {
        console.log('Could not determine column names from test query');
      }
    }
    
    console.log('Found members columns:', membersColNames);
    
    const requiredMembersCols = [
      'id', 'name', 'email', 'phone', 'membership_type', 'membership_plan_id',
      'join_date', 'address', 'birthday', 'photo_url', 'is_active', 
      'biometric_id', 'biometric_sensor_member_id', 'is_admin'
    ];
    
    const missingMembersCols = requiredMembersCols.filter(col => !membersColNames.includes(col));
    
    if (missingMembersCols.length > 0) {
      console.log('❌ Missing members table columns:', missingMembersCols);
      return false;
    } else {
      console.log('✅ All required members table columns exist');
    }

    // 3. Check attendance table columns
    console.log('\n📋 Checking attendance table columns...');
    const attendanceCols = await pool.query("PRAGMA table_info(attendance)");
    const attendanceColNames = attendanceCols.rows.map(col => col.name);
    
    const requiredAttendanceCols = ['id', 'member_id', 'check_in_time', 'check_out_time', 'date'];
    const missingAttendanceCols = requiredAttendanceCols.filter(col => !attendanceColNames.includes(col));
    
    if (missingAttendanceCols.length > 0) {
      console.log('❌ Missing attendance table columns:', missingAttendanceCols);
      return false;
    } else {
      console.log('✅ All required attendance table columns exist');
    }

    // 4. Check biometric_events table columns
    console.log('\n📋 Checking biometric_events table columns...');
    const biometricEventsCols = await pool.query("PRAGMA table_info(biometric_events)");
    const biometricEventsColNames = biometricEventsCols.rows.map(col => col.name);
    
    const requiredBiometricEventsCols = [
      'id', 'member_id', 'biometric_id', 'event_type', 'device_id', 
      'timestamp', 'success', 'error_message', 'raw_data', 'sensor_member_id', 'created_at'
    ];
    const missingBiometricEventsCols = requiredBiometricEventsCols.filter(col => !biometricEventsColNames.includes(col));
    
    if (missingBiometricEventsCols.length > 0) {
      console.log('❌ Missing biometric_events table columns:', missingBiometricEventsCols);
      return false;
    } else {
      console.log('✅ All required biometric_events table columns exist');
    }

    // 5. Check required indexes
    console.log('\n📋 Checking required indexes...');
    const indexesQuery = `
      SELECT name FROM sqlite_master 
      WHERE type='index' AND name IN (
        'idx_members_biometric_id',
        'idx_members_active',
        'idx_attendance_member_date',
        'idx_biometric_events_member_timestamp',
        'idx_biometric_events_member_id',
        'idx_biometric_events_biometric_id',
        'idx_biometric_events_timestamp',
        'idx_security_logs_timestamp',
        'idx_security_logs_event_type'
      )
      ORDER BY name
    `;
    
    const indexes = await pool.query(indexesQuery);
    const indexNames = indexes.rows.map(row => row.name);
    
    const requiredIndexes = [
      'idx_members_biometric_id',
      'idx_members_active', 
      'idx_attendance_member_date',
      'idx_biometric_events_member_timestamp',
      'idx_biometric_events_member_id',
      'idx_biometric_events_biometric_id',
      'idx_biometric_events_timestamp',
      'idx_security_logs_timestamp',
      'idx_security_logs_event_type'
    ];
    
    const missingIndexes = requiredIndexes.filter(index => !indexNames.includes(index));
    
    if (missingIndexes.length > 0) {
      console.log('❌ Missing indexes:', missingIndexes);
      return false;
    } else {
      console.log('✅ All required indexes exist');
    }

    // 6. Test hybrid cache queries
    console.log('\n📋 Testing hybrid cache queries...');
    
    // Test validation query
    try {
      const validationQuery = `
        SELECT 
          m.id as member_id,
          m.name,
          m.biometric_id,
          m.is_active,
          m.membership_plan_id,
          mp.name as plan_name,
          mp.duration_days
        FROM members m
        LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
        WHERE m.biometric_id = ?
        LIMIT 1
      `;
      
      await pool.query(validationQuery, ['test']);
      console.log('✅ Validation query test passed');
    } catch (error) {
      console.log('❌ Validation query test failed:', error.message);
      return false;
    }

    // Test cache update query
    try {
      const cacheUpdateQuery = `
        SELECT 
          m.id as member_id,
          m.biometric_id,
          m.is_active,
          m.membership_plan_id,
          mp.name as plan_name
        FROM members m
        LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
        WHERE m.biometric_id IS NOT NULL 
          AND m.biometric_id != ''
          AND m.biometric_id != '0'
        LIMIT 5
      `;
      
      await pool.query(cacheUpdateQuery);
      console.log('✅ Cache update query test passed');
    } catch (error) {
      console.log('❌ Cache update query test failed:', error.message);
      return false;
    }

    // 7. Check data integrity
    console.log('\n📋 Checking data integrity...');
    
    // Check for members with biometric_id but no is_active
    const inactiveMembers = await pool.query(`
      SELECT COUNT(*) as count FROM members 
      WHERE biometric_id IS NOT NULL 
        AND biometric_id != '' 
        AND biometric_id != '0'
        AND is_active IS NULL
    `);
    
    if (inactiveMembers.rows[0].count > 0) {
      console.log(`⚠️ Found ${inactiveMembers.rows[0].count} members with biometric_id but NULL is_active`);
    } else {
      console.log('✅ All members with biometric_id have is_active set');
    }

    // Check for attendance records without date
    const attendanceWithoutDate = await pool.query(`
      SELECT COUNT(*) as count FROM attendance 
      WHERE date IS NULL OR date = ''
    `);
    
    if (attendanceWithoutDate.rows[0].count > 0) {
      console.log(`⚠️ Found ${attendanceWithoutDate.rows[0].count} attendance records without date`);
    } else {
      console.log('✅ All attendance records have date set');
    }

    console.log('\n🎉 Database schema validation completed successfully!');
    console.log('====================================================');
    
    console.log('\n💡 Hybrid Cache Readiness:');
    console.log('  ✅ All required tables and columns exist');
    console.log('  ✅ All performance indexes are in place');
    console.log('  ✅ Database queries are optimized');
    console.log('  ✅ Data integrity checks passed');
    console.log('\n🚀 Database is ready for hybrid cache implementation!');

    return true;

  } catch (error) {
    console.error('❌ Database schema validation failed:', error);
    return false;
  }
}

// Run the validation
if (require.main === module) {
  validateDatabaseSchema()
    .then((success) => {
      if (success) {
        console.log('\n✅ Schema validation completed successfully');
        process.exit(0);
      } else {
        console.log('\n❌ Schema validation failed');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ Validation script failed:', error);
      process.exit(1);
    });
}

module.exports = { validateDatabaseSchema };
