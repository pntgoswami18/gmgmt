#!/usr/bin/env node

/**
 * Simple Database Schema Validation Script for Hybrid Cache Implementation
 * 
 * This script performs essential checks to ensure the database is ready
 * for the hybrid cache implementation.
 */

const { pool } = require('../src/config/sqlite');

async function validateDatabaseSchema() {
  console.log('🔍 Starting database schema validation for hybrid cache...');
  console.log('====================================================');

  try {
    // 1. Test basic database connectivity
    console.log('📋 Testing database connectivity...');
    const connectivityTest = await pool.query("SELECT 1 as test");
    if (connectivityTest.rows.length === 0) {
      console.log('❌ Database connectivity test failed');
      return false;
    }
    console.log('✅ Database connectivity test passed');

    // 2. Check if members table exists and has required columns
    console.log('\n📋 Checking members table...');
    try {
      const membersTest = await pool.query(`
        SELECT 
          id, name, email, phone, membership_type, membership_plan_id,
          join_date, address, birthday, photo_url, is_active, 
          biometric_id, biometric_sensor_member_id, is_admin
        FROM members 
        LIMIT 1
      `);
      console.log('✅ Members table has all required columns');
    } catch (error) {
      console.log('❌ Members table missing required columns:', error.message);
      return false;
    }

    // 3. Check if attendance table exists and has required columns
    console.log('\n📋 Checking attendance table...');
    try {
      const attendanceTest = await pool.query(`
        SELECT 
          id, member_id, check_in_time, check_out_time, date
        FROM attendance 
        LIMIT 1
      `);
      console.log('✅ Attendance table has all required columns');
    } catch (error) {
      console.log('❌ Attendance table missing required columns:', error.message);
      return false;
    }

    // 4. Check if biometric_events table exists
    console.log('\n📋 Checking biometric_events table...');
    try {
      const biometricEventsTest = await pool.query(`
        SELECT 
          id, member_id, biometric_id, event_type, device_id, 
          timestamp, success, error_message, raw_data, sensor_member_id, created_at
        FROM biometric_events 
        LIMIT 1
      `);
      console.log('✅ Biometric_events table has all required columns');
    } catch (error) {
      console.log('❌ Biometric_events table missing required columns:', error.message);
      return false;
    }

    // 5. Test hybrid cache validation query
    console.log('\n📋 Testing hybrid cache validation query...');
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
      console.log('✅ Hybrid cache validation query test passed');
    } catch (error) {
      console.log('❌ Hybrid cache validation query test failed:', error.message);
      return false;
    }

    // 6. Test hybrid cache update query
    console.log('\n📋 Testing hybrid cache update query...');
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
      console.log('✅ Hybrid cache update query test passed');
    } catch (error) {
      console.log('❌ Hybrid cache update query test failed:', error.message);
      return false;
    }

    // 7. Check for required indexes
    console.log('\n📋 Checking required indexes...');
    const indexesQuery = `
      SELECT name FROM sqlite_master 
      WHERE type='index' AND name IN (
        'idx_members_biometric_id',
        'idx_members_active',
        'idx_attendance_member_date',
        'idx_biometric_events_member_timestamp'
      )
    `;
    
    const indexes = await pool.query(indexesQuery);
    const indexNames = indexes.rows.map(row => row.name);
    
    const requiredIndexes = [
      'idx_members_biometric_id',
      'idx_members_active', 
      'idx_attendance_member_date',
      'idx_biometric_events_member_timestamp'
    ];
    
    const missingIndexes = requiredIndexes.filter(index => !indexNames.includes(index));
    
    if (missingIndexes.length > 0) {
      console.log('⚠️ Missing indexes:', missingIndexes);
      console.log('   Run: node tools/add_hybrid_cache_indexes.js');
    } else {
      console.log('✅ All required indexes exist');
    }

    console.log('\n🎉 Database schema validation completed successfully!');
    console.log('====================================================');
    
    console.log('\n💡 Hybrid Cache Readiness:');
    console.log('  ✅ Database connectivity confirmed');
    console.log('  ✅ All required tables and columns exist');
    console.log('  ✅ Hybrid cache queries are working');
    console.log('  ✅ Database is ready for hybrid cache implementation');
    
    if (missingIndexes.length > 0) {
      console.log('\n⚠️ Recommendation: Run the index optimization script');
      console.log('   node tools/add_hybrid_cache_indexes.js');
    }

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
