#!/usr/bin/env node

/**
 * Database Optimization Script for Hybrid Cache Implementation
 * 
 * This script adds database indexes to optimize the hybrid cache performance:
 * - Index on members.biometric_id for fast member lookup
 * - Index on member_plans for active plan queries
 * - Index on attendance for check-in/check-out queries
 * 
 * Run this script after implementing the hybrid cache to improve performance.
 */

const { pool } = require('../src/config/sqlite');
const path = require('path');

async function addHybridCacheIndexes() {
  console.log('🚀 Starting hybrid cache database optimization...');
  console.log('==========================================');

  try {
    // Check if indexes already exist
    const checkIndexesQuery = `
      SELECT name FROM sqlite_master 
      WHERE type='index' AND name IN (
        'idx_members_biometric_id',
        'idx_members_active',
        'idx_attendance_member_date',
        'idx_biometric_events_member_timestamp'
      )
    `;
    
    const existingIndexes = await pool.query(checkIndexesQuery);
    const existingIndexNames = existingIndexes.rows.map(row => row.name);
    
    console.log('📋 Existing indexes:', existingIndexNames);

    // 1. Index on members.biometric_id for fast member lookup
    if (!existingIndexNames.includes('idx_members_biometric_id')) {
      console.log('📊 Adding index on members.biometric_id...');
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_members_biometric_id 
        ON members(biometric_id)
      `);
      console.log('✅ Index on members.biometric_id created');
    } else {
      console.log('⏭️  Index on members.biometric_id already exists');
    }

    // 2. Index on members for active status queries
    if (!existingIndexNames.includes('idx_members_active')) {
      console.log('📊 Adding index on members.is_active...');
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_members_active 
        ON members(is_active, membership_plan_id)
      `);
      console.log('✅ Index on members.is_active created');
    } else {
      console.log('⏭️  Index on members.is_active already exists');
    }

    // 3. Index on attendance for check-in/check-out queries
    if (!existingIndexNames.includes('idx_attendance_member_date')) {
      console.log('📊 Adding composite index on attendance...');
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_attendance_member_date 
        ON attendance(member_id, date, check_in_time)
      `);
      console.log('✅ Composite index on attendance created');
    } else {
      console.log('⏭️  Composite index on attendance already exists');
    }

    // 4. Index on biometric_events for audit queries
    if (!existingIndexNames.includes('idx_biometric_events_member_timestamp')) {
      console.log('📊 Adding composite index on biometric_events...');
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_biometric_events_member_timestamp 
        ON biometric_events(member_id, timestamp, event_type)
      `);
      console.log('✅ Composite index on biometric_events created');
    } else {
      console.log('⏭️  Composite index on biometric_events already exists');
    }

    // 5. Additional optimization: Analyze tables for query planner
    console.log('📊 Analyzing tables for query optimization...');
    await pool.query('ANALYZE');
    console.log('✅ Database analysis completed');

    // 6. Show final index status
    console.log('\n📋 Final index status:');
    const finalIndexes = await pool.query(`
      SELECT name, sql FROM sqlite_master 
      WHERE type='index' AND name LIKE 'idx_%'
      ORDER BY name
    `);
    
    finalIndexes.rows.forEach(index => {
      console.log(`  - ${index.name}`);
    });

    console.log('\n🎉 Hybrid cache database optimization completed successfully!');
    console.log('==========================================');
    
    // Performance tips
    console.log('\n💡 Performance Tips:');
    console.log('  - Cache hit rate should be >80% for optimal performance');
    console.log('  - Monitor cache update frequency (every 5 minutes)');
    console.log('  - Check server logs for validation response times');
    console.log('  - Consider increasing cache size if you have >100 members');

  } catch (error) {
    console.error('❌ Error during database optimization:', error);
    process.exit(1);
  } finally {
    // Close database connection
    if (pool && pool.end) {
      await pool.end();
    }
  }
}

// Run the optimization
if (require.main === module) {
  addHybridCacheIndexes()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { addHybridCacheIndexes };
