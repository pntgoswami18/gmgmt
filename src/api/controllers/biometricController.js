const { pool } = require('../../config/sqlite');
const whatsappService = require('../../services/whatsappService');

// Get reference to biometric integration instance
let biometricIntegration = null;

const setBiometricIntegration = (integration) => {
  biometricIntegration = integration;
};

// Get biometric status for a member
const getMemberBiometricStatus = async (req, res) => {
  try {
    const { memberId } = req.params;
    
    console.log('🔍 getMemberBiometricStatus called for member:', memberId);
    console.log('🔍 biometricIntegration available:', !!biometricIntegration);
    
    if (!biometricIntegration) {
      console.log('❌ Biometric service not available');
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    console.log('🔍 Calling biometricIntegration.getMemberBiometricStatus...');
    const status = await biometricIntegration.getMemberBiometricStatus(parseInt(memberId));
    
    console.log('🔍 Status result:', status);
    
    if (!status) {
      console.log('❌ Status is null, returning Member not found');
      return res.status(404).json({ 
        success: false, 
        message: 'Member not found' 
      });
    }

    console.log('✅ Successfully got biometric status');
    res.json({ 
      success: true, 
      data: status 
    });
  } catch (error) {
    console.error('❌ Error getting member biometric status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get biometric status',
      error: error.message 
    });
  }
};

// Start enrollment for a member
const startEnrollment = async (req, res) => {
  try {
    const { memberId } = req.params;
    
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    // Get member details
    const memberResult = await pool.query('SELECT id, name, biometric_id FROM members WHERE id = ?', [memberId]);
    const member = memberResult.rows[0];

    if (!member) {
      return res.status(404).json({ 
        success: false, 
        message: 'Member not found' 
      });
    }

    // Check if member already has biometric data
    if (member.biometric_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Member already has biometric data enrolled. Remove existing data first.' 
      });
    }

    // Start enrollment mode
    const enrollmentSession = biometricIntegration.startEnrollmentMode(member.id, member.name);
    
    res.json({ 
      success: true, 
      message: 'Enrollment mode started',
      data: {
        session: enrollmentSession,
        instructions: 'Please ask the member to place their finger on the biometric device multiple times as instructed.'
      }
    });
  } catch (error) {
    console.error('Error starting enrollment:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to start enrollment',
      error: error.message 
    });
  }
};

// Stop enrollment
const stopEnrollment = async (req, res) => {
  try {
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    // Get the current enrollment session details
    const enrollmentSession = biometricIntegration.enrollmentMode;
    if (!enrollmentSession || !enrollmentSession.active) {
      return res.status(400).json({ 
        success: false, 
        message: 'No active enrollment session' 
      });
    }

    const { memberId, memberName } = enrollmentSession;

    // Send cancel command to all online ESP32 devices
    const devicesQuery = `
      SELECT DISTINCT device_id 
      FROM biometric_events 
      WHERE device_id IS NOT NULL 
        AND timestamp > datetime('now', '-5 minutes')
      GROUP BY device_id
    `;
    
    const devicesResult = await pool.query(devicesQuery);
    const devices = devicesResult.rows || [];
    
    let cancelsSent = 0;
    const results = [];

    for (const device of devices) {
      try {
        await biometricIntegration.sendESP32Command(device.device_id, 'cancel_enrollment', {
          memberId: memberId,
          reason: 'user_cancelled'
        });
        cancelsSent++;
        results.push({ deviceId: device.device_id, status: 'sent' });
      } catch (error) {
        console.error(`Failed to send cancel to ${device.device_id}:`, error.message);
        results.push({ deviceId: device.device_id, status: 'failed', error: error.message });
      }
    }

    // Stop the enrollment mode in the backend
    const result = biometricIntegration.stopEnrollmentMode('manual');
    
    // Log cancellation event
    await biometricIntegration.logBiometricEvent({
      member_id: memberId,
      biometric_id: null,
      event_type: 'enrollment_cancelled',
      device_id: 'system',
      timestamp: new Date().toISOString(),
      success: true,
      raw_data: JSON.stringify({ 
        reason: 'user_cancelled',
        memberName,
        devicesCancelled: cancelsSent,
        results
      })
    });

    res.json({ 
      success: true, 
      message: `Enrollment stopped for ${memberName}. Cancel commands sent to ${cancelsSent} device(s).`,
      data: {
        ...result,
        memberId,
        memberName,
        cancelsSent,
        totalDevices: devices.length,
        results
      }
    });
  } catch (error) {
    console.error('Error stopping enrollment:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to stop enrollment',
      error: error.message 
    });
  }
};

// Cancel enrollment (send cancel command to ESP32 devices)
const cancelEnrollment = async (req, res) => {
  try {
    const { memberId, reason = 'user_cancelled' } = req.body;
    
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    // Get member details for logging
    const memberResult = await pool.query('SELECT id, name FROM members WHERE id = ?', [memberId]);
    const member = memberResult.rows[0];
    const memberName = member ? member.name : `Member ${memberId}`;

    // Send cancel command to all online ESP32 devices
    const devicesQuery = `
      SELECT DISTINCT device_id 
      FROM biometric_events 
      WHERE device_id IS NOT NULL 
        AND timestamp > datetime('now', '-5 minutes')
      GROUP BY device_id
    `;
    
    const devicesResult = await pool.query(devicesQuery);
    const devices = devicesResult.rows || [];
    
    let cancelsSent = 0;
    const results = [];

    for (const device of devices) {
      try {
        await biometricIntegration.sendESP32Command(device.device_id, 'cancel_enrollment', {
          memberId: memberId,
          reason: reason
        });
        cancelsSent++;
        results.push({ deviceId: device.device_id, status: 'sent' });
      } catch (error) {
        console.error(`Failed to send cancel to ${device.device_id}:`, error.message);
        results.push({ deviceId: device.device_id, status: 'failed', error: error.message });
      }
    }

    // Log cancellation event
    await biometricIntegration.logBiometricEvent({
      member_id: memberId,
      biometric_id: null,
      event_type: 'enrollment_cancelled',
      device_id: 'system',
      timestamp: new Date().toISOString(),
      success: true,
      raw_data: JSON.stringify({ 
        reason,
        memberName,
        devicesCancelled: cancelsSent,
        results
      })
    });

    res.json({ 
      success: true, 
      message: `Enrollment cancelled for ${memberName}. Cancel commands sent to ${cancelsSent} device(s).`,
      data: {
        memberId,
        memberName,
        cancelsSent,
        totalDevices: devices.length,
        results
      }
    });
  } catch (error) {
    console.error('Error cancelling enrollment:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to cancel enrollment',
      error: error.message 
    });
  }
};

// Remove biometric data for a member
const removeBiometricData = async (req, res) => {
  try {
    const { memberId } = req.params;
    
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    const success = await biometricIntegration.removeBiometricId(parseInt(memberId));
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'Biometric data removed successfully' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to remove biometric data' 
      });
    }
  } catch (error) {
    console.error('Error removing biometric data:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to remove biometric data',
      error: error.message 
    });
  }
};

// Get enrollment status (check if enrollment is active)
const getEnrollmentStatus = async (req, res) => {
  try {
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    const isActive = biometricIntegration.enrollmentMode && biometricIntegration.enrollmentMode.active;
    
    res.json({ 
      success: true, 
      data: {
        active: isActive,
        enrollmentMode: isActive ? biometricIntegration.enrollmentMode : null
      }
    });
  } catch (error) {
    console.error('Error getting enrollment status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get enrollment status',
      error: error.message 
    });
  }
};

// Get biometric events/logs with pagination
const getBiometricEvents = async (req, res) => {
  try {
    const { memberId, page = 1, limit = 50, search = '' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT be.*, m.name as member_name 
      FROM biometric_events be
      LEFT JOIN members m ON be.member_id = m.id
      WHERE 1=1
    `;
    let params = [];

    if (memberId) {
      query += ' AND be.member_id = ?';
      params.push(memberId);
    }

    // Add search condition
    if (search.trim()) {
      query += ' AND (m.name ILIKE ? OR be.event_type ILIKE ? OR be.message ILIKE ?)';
      const searchTerm = `%${search.trim()}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM biometric_events be LEFT JOIN members m ON be.member_id = m.id WHERE 1=1';
    let countParams = [];

    if (memberId) {
      countQuery += ' AND be.member_id = ?';
      countParams.push(memberId);
    }

    if (search.trim()) {
      countQuery += ' AND (m.name ILIKE ? OR be.event_type ILIKE ? OR be.message ILIKE ?)';
      const searchTerm = `%${search.trim()}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    // Add ordering and pagination
    query += ' ORDER BY be.timestamp DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const eventsResult = await pool.query(query, params);
    const events = eventsResult.rows || [];

    res.json({ 
      success: true, 
      data: events,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error getting biometric events:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get biometric events',
      error: error.message
    });
  }
};

// Get system status
const getSystemStatus = async (req, res) => {
  try {
    const status = {
      biometricServiceAvailable: !!biometricIntegration,
      enrollmentActive: false,
      connectedDevices: 0,
      lastActivity: null
    };

    if (biometricIntegration) {
      status.enrollmentActive = biometricIntegration.enrollmentMode && 
                               biometricIntegration.enrollmentMode.active;
      
      // Count ESP32 devices that have sent heartbeats in the last 5 minutes
      // This is more accurate than TCP socket connections since ESP32 uses HTTP webhooks
      try {
        // First, let's check if the biometric_events table exists and has data
        const tableCheckQuery = `
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='biometric_events'
        `;
        
        const tableCheck = await pool.query(tableCheckQuery);
        if (tableCheck.rows.length === 0) {
          console.warn('⚠️ biometric_events table does not exist');
          status.connectedDevices = 0;
          status.lastActivity = null;
          status.debug = { error: 'biometric_events table not found' };
        } else {
          // Check total events in the table
          const totalEventsQuery = `SELECT COUNT(*) as total FROM biometric_events`;
          const totalEventsResult = await pool.query(totalEventsQuery);
          const totalEvents = totalEventsResult.rows[0]?.total || 0;
          
          // Check recent heartbeats
          const query = `
            SELECT COUNT(DISTINCT device_id) as device_count
            FROM biometric_events 
            WHERE event_type = 'heartbeat' 
              AND device_id IS NOT NULL 
              AND timestamp > datetime('now', '-5 minutes')
          `;
          
          const result = await pool.query(query);
          status.connectedDevices = parseInt(result.rows[0]?.device_count || 0);
          
          // Get last activity timestamp
          const lastActivityQuery = `
            SELECT MAX(timestamp) as last_activity
            FROM biometric_events 
            WHERE device_id IS NOT NULL
          `;
          
          const lastActivityResult = await pool.query(lastActivityQuery);
          status.lastActivity = lastActivityResult.rows[0]?.last_activity || null;
          
          // Add debug info
          status.debug = {
            tableExists: true,
            totalEvents,
            recentHeartbeats: status.connectedDevices,
            lastActivity: status.lastActivity
          };
        }
        
      } catch (dbError) {
        console.warn('Could not query device count from database, falling back to TCP connections:', dbError.message);
        // Fallback to TCP socket count for backward compatibility
        status.connectedDevices = biometricIntegration.listener.clients.size;
        status.debug = { 
          error: dbError.message, 
          fallback: 'TCP connections',
          tcpConnections: biometricIntegration.listener.clients.size
        };
      }
    }

    res.json({ 
      success: true, 
      data: status 
    });
  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get system status',
      error: error.message 
    });
  }
};

// Get members without biometric data with pagination
const getMembersWithoutBiometric = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    // Build search condition
    let searchCondition = '';
    let searchParams = [];
    if (search.trim()) {
      searchCondition = `AND (name ILIKE $${searchParams.length + 1} OR email ILIKE $${searchParams.length + 2} OR phone ILIKE $${searchParams.length + 3})`;
      const searchTerm = `%${search.trim()}%`;
      searchParams.push(searchTerm, searchTerm, searchTerm);
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM members 
      WHERE (biometric_id IS NULL OR biometric_id = '') AND is_active = 1 ${searchCondition}
    `;
    const countResult = await pool.query(countQuery, searchParams);
    const total = parseInt(countResult.rows[0].total, 10);

    // Get paginated results
    const query = `
      SELECT id, name, email, phone, join_date, is_admin 
      FROM members 
      WHERE (biometric_id IS NULL OR biometric_id = '') AND is_active = 1 ${searchCondition}
      ORDER BY name ASC 
      LIMIT $${searchParams.length + 1} OFFSET $${searchParams.length + 2}
    `;
    const result = await pool.query(query, [...searchParams, limitNum, offset]);
    const members = result.rows || [];

    console.log(`Found ${members.length} members without biometric data (page ${pageNum})`);

    res.json({ 
      success: true, 
      data: members,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error getting members without biometric:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get members without biometric data',
      error: error.message 
    });
  }
};

// Get members with biometric data with pagination
const getMembersWithBiometric = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    // Build search condition
    let searchCondition = '';
    let searchParams = [];
    if (search.trim()) {
      searchCondition = `AND (name ILIKE $${searchParams.length + 1} OR email ILIKE $${searchParams.length + 2} OR phone ILIKE $${searchParams.length + 3})`;
      const searchTerm = `%${search.trim()}%`;
      searchParams.push(searchTerm, searchTerm, searchTerm);
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM members 
      WHERE biometric_id IS NOT NULL AND biometric_id != '' AND is_active = 1 ${searchCondition}
    `;
    const countResult = await pool.query(countQuery, searchParams);
    const total = parseInt(countResult.rows[0].total, 10);

    // Get paginated results
    const query = `
      SELECT id, name, email, phone, join_date, biometric_id, is_admin
      FROM members 
      WHERE biometric_id IS NOT NULL AND biometric_id != '' AND is_active = 1 ${searchCondition}
      ORDER BY name ASC 
      LIMIT $${searchParams.length + 1} OFFSET $${searchParams.length + 2}
    `;
    const result = await pool.query(query, [...searchParams, limitNum, offset]);
    const members = result.rows || [];
    
    console.log(`Found ${members.length} members with biometric data (page ${pageNum})`);
    
    res.json({
      success: true,
      data: members,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error getting members with biometric:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get members with biometric data',
      error: error.message
    });
  }
};

// Test biometric connection
const testConnection = async (req, res) => {
  try {
    const { host, port } = req.body;
    
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    // If host and port are provided, test specific ESP32 device connectivity
    if (host && port) {
      const net = require('net');
      
      return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = 5000; // 5 second timeout
        
        socket.setTimeout(timeout);
        
        socket.on('connect', () => {
          socket.destroy();
          res.json({
            success: true,
            message: `ESP32 device is reachable at ${host}:${port}`,
            data: {
              host,
              port,
              status: 'reachable'
            }
          });
          resolve();
        });
        
        socket.on('timeout', () => {
          socket.destroy();
          res.json({
            success: false,
            message: `Connection timeout to ${host}:${port}. Device may be offline or unreachable.`,
            data: {
              host,
              port,
              status: 'timeout'
            }
          });
          resolve();
        });
        
        socket.on('error', (err) => {
          socket.destroy();
          res.json({
            success: false,
            message: `Cannot reach ESP32 device at ${host}:${port}. Error: ${err.code || err.message}`,
            data: {
              host,
              port,
              status: 'error',
              error: err.code || err.message
            }
          });
          resolve();
        });
        
        socket.connect(port, host);
      });
    }

    // If no specific host/port, test existing ESP32 devices by checking recent heartbeats
    try {
      // Get count of ESP32 devices that have sent heartbeats in the last 5 minutes
      const query = `
        SELECT COUNT(DISTINCT device_id) as device_count
        FROM biometric_events 
        WHERE event_type = 'heartbeat' 
          AND device_id IS NOT NULL 
          AND timestamp > datetime('now', '-5 minutes')
      `;
      
      const result = await pool.query(query);
      const connectedDevices = parseInt(result.rows[0]?.device_count || 0);
      
      // Get last heartbeat time for each device
      let deviceDetails = [];
      if (connectedDevices > 0) {
        const detailsQuery = `
          SELECT device_id, MAX(timestamp) as last_heartbeat, 
                 COUNT(*) as heartbeat_count
          FROM biometric_events 
          WHERE event_type = 'heartbeat' 
            AND device_id IS NOT NULL 
            AND timestamp > datetime('now', '-5 minutes')
          GROUP BY device_id
          ORDER BY last_heartbeat DESC
        `;
        
        const detailsResult = await pool.query(detailsQuery);
        deviceDetails = detailsResult.rows || [];
      }

      res.json({ 
        success: true, 
        message: `Found ${connectedDevices} ESP32 device(s) with recent heartbeats`,
        data: {
          connectedDevices,
          deviceDetails,
          testTime: new Date().toISOString(),
          note: 'ESP32 devices communicate via HTTP webhooks, not TCP sockets'
        }
      });
      
    } catch (dbError) {
      console.warn('Could not query device status from database, falling back to TCP connections:', dbError.message);
      
      // Fallback to TCP socket test for backward compatibility
      const testMessage = 'TEST:CONNECTION:' + new Date().toISOString();
      biometricIntegration.listener.broadcast(testMessage);

      res.json({ 
        success: true, 
        message: 'Test message sent to TCP-connected devices (fallback mode)',
        data: {
          connectedDevices: biometricIntegration.listener.clients.size,
          testMessage,
          note: 'Using TCP socket fallback - ESP32 devices typically use HTTP webhooks'
        }
      });
    }
  } catch (error) {
    console.error('Error testing connection:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to test connection',
      error: error.message 
    });
  }
};

// Manual enrollment - assign device user ID to member
const manualEnrollment = async (req, res) => {
  try {
    const { memberId } = req.params;
    const { deviceUserId } = req.body;
    
    if (!deviceUserId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Device User ID is required' 
      });
    }

    // Get member details
    const memberResult = await pool.query('SELECT id, name, biometric_id FROM members WHERE id = ?', [memberId]);
    const member = memberResult.rows[0];

    if (!member) {
      return res.status(404).json({ 
        success: false, 
        message: 'Member not found' 
      });
    }

    // Check if member already has biometric data
    if (member.biometric_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Member already has biometric data enrolled. Remove existing data first.' 
      });
    }

    // Check if device user ID is already assigned
    const existingResult = await pool.query('SELECT id, name FROM members WHERE biometric_id = ?', [deviceUserId]);
    if (existingResult.rows.length > 0) {
      const existingMember = existingResult.rows[0];
      return res.status(409).json({ 
        success: false, 
        message: `Device User ID ${deviceUserId} is already assigned to ${existingMember.name} (ID: ${existingMember.id})` 
      });
    }

    // Assign device user ID to member
    await pool.query('UPDATE members SET biometric_id = ? WHERE id = ?', [deviceUserId, memberId]);

    // Log enrollment event
    if (biometricIntegration) {
      const enrollmentEvent = {
        member_id: memberId,
        biometric_id: deviceUserId,
        event_type: 'manual_enrollment',
        device_id: 'manual',
        timestamp: new Date().toISOString(),
        success: true,
        raw_data: JSON.stringify({ method: 'manual', deviceUserId })
      };

      await biometricIntegration.logBiometricEvent(enrollmentEvent);
    }

    // Send WhatsApp welcome message for manual enrollment
    try {
      const whatsappResult = await whatsappService.sendWelcomeMessage(
        memberId, 
        member.name, 
        member.phone
      );
      
      if (whatsappResult.success) {
        console.log(`📱 WhatsApp welcome message prepared for ${member.name} (manual enrollment)`);
      } else {
        console.log(`📱 WhatsApp welcome message failed for ${member.name}: ${whatsappResult.error}`);
      }
    } catch (whatsappError) {
      console.error('📱 Error sending WhatsApp welcome message (manual enrollment):', whatsappError);
    }
    
    res.json({ 
      success: true, 
      message: `Device User ID ${deviceUserId} successfully assigned to ${member.name}`,
      data: {
        memberId: memberId,
        memberName: member.name,
        deviceUserId: deviceUserId
      }
    });
  } catch (error) {
    console.error('Error in manual enrollment:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to assign device user ID',
      error: error.message 
    });
  }
};

// Get detailed biometric information for a member
const getMemberBiometricDetails = async (req, res) => {
  try {
    const { memberId } = req.params;
    
    // Get member details with all biometric fields
    const memberResult = await pool.query(
      'SELECT id, name, email, phone, biometric_id FROM members WHERE id = ?', 
      [memberId]
    );
    const member = memberResult.rows[0];

    if (!member) {
      return res.status(404).json({ 
        success: false, 
        message: 'Member not found' 
      });
    }

    // Get biometric event history
    const eventsResult = await pool.query(`
      SELECT 
        id, member_id, biometric_id, event_type, 
        device_id, timestamp, success, error_message, raw_data
      FROM biometric_events 
      WHERE member_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 20
    `, [memberId]);

    const biometricDetails = {
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        biometric_id: member.biometric_id,
        has_biometric_data: !!member.biometric_id
      },
      events: eventsResult.rows || [],
      summary: {
        total_events: eventsResult.rows?.length || 0,
        device_user_id: member.biometric_id,
        last_event: eventsResult.rows?.[0] || null
      }
    };

    res.json({ 
      success: true, 
      data: biometricDetails 
    });
  } catch (error) {
    console.error('Error getting member biometric details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get member biometric details',
      error: error.message 
    });
  }
};

// ESP32 Device Control Functions
const unlockDoorRemotely = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { reason = 'admin_unlock' } = req.body;
    
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    await biometricIntegration.unlockDoorRemotely(deviceId, reason);
    
    res.json({ 
      success: true, 
      message: `Remote unlock command sent to device ${deviceId}`,
      deviceId: deviceId,
      reason: reason
    });
  } catch (error) {
    console.error('Error unlocking door remotely:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to unlock door remotely',
      error: error.message 
    });
  }
};

const startRemoteEnrollment = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { memberId } = req.body;
    
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    if (!memberId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Member ID is required' 
      });
    }

    const result = await biometricIntegration.startRemoteEnrollment(deviceId, memberId);
    
    res.json({ 
      success: true, 
      message: `Remote enrollment started for member ${memberId} on device ${deviceId}`,
      data: result
    });
  } catch (error) {
    console.error('Error starting remote enrollment:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to start remote enrollment',
      error: error.message 
    });
  }
};

const getDeviceStatus = async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    const status = await biometricIntegration.getDeviceStatus(deviceId);
    
    res.json({ 
      success: true, 
      deviceId: deviceId,
      status: status
    });
  } catch (error) {
    console.error('Error getting device status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get device status',
      error: error.message 
    });
  }
};

const getAllDevices = async (req, res) => {
  try {
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    // Get all devices that have sent heartbeats in the last 24 hours
    const query = `
      SELECT DISTINCT device_id, 
             MAX(timestamp) as last_seen,
             COUNT(*) as event_count
      FROM biometric_events 
      WHERE device_id IS NOT NULL 
        AND timestamp > datetime('now', '-24 hours')
      GROUP BY device_id
      ORDER BY last_seen DESC
    `;
    
    const result = await pool.query(query);
    const devices = result.rows || [];
    
    // Get status for each device
    const devicesWithStatus = await Promise.all(
      devices.map(async (device) => {
        const status = await biometricIntegration.getDeviceStatus(device.device_id);
        return {
          ...device,
          ...status
        };
      })
    );
    
    res.json({ 
      success: true, 
      devices: devicesWithStatus,
      count: devicesWithStatus.length
    });
  } catch (error) {
    console.error('Error getting all devices:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get devices',
      error: error.message 
    });
  }
};

// ESP32 Device Webhook - receives data from ESP32 devices
const esp32Webhook = async (req, res) => {
  try {
    const eventData = req.body;
    
    if (!eventData) {
      return res.status(400).json({ 
        success: false, 
        message: 'No data provided' 
      });
    }

    // Log the received data for debugging
    console.log('📱 ESP32 webhook data received:', JSON.stringify(eventData, null, 2));
    console.log('🔍 Request details:', {
      method: req.method,
      url: req.url,
      headers: req.headers,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Extract common fields
    const {
      deviceId,
      deviceType,
      event,
      status,
      timestamp,
      userId,
      memberId,
      ip_address,
      wifi_rssi,
      free_heap,
      enrolled_prints
    } = eventData;
    
    // Log the extracted fields for debugging
    console.log('🔍 Extracted fields:', {
      deviceId,
      deviceType,
      event,
      status,
      timestamp,
      userId,
      memberId,
      enrollmentStep: eventData.enrollmentStep
    });

    if (!biometricIntegration) {
      console.warn('⚠️ Biometric integration not available, storing raw event');
      console.warn('⚠️ This means WebSocket updates and enrollment status updates will not work');
      console.warn('⚠️ Check if biometricIntegration service is properly initialized');
      return res.json({ 
        success: true, 
        message: 'Event received but biometric integration not active',
        stored: false
      });
    }
    
    console.log(`✅ Biometric integration available, proceeding with event processing`);

    // Determine event type and handle accordingly
    let eventType = 'unknown';
    let memberIdToUse = null;
    let biometricId = null;
    let success = true;

    if (event === 'heartbeat') {
      eventType = 'heartbeat';
      // For heartbeat events, respond immediately and process asynchronously
      res.json({ 
        success: true, 
        message: 'Heartbeat received',
        device_id: deviceId,
        timestamp: timestamp
      });
      
      // Process heartbeat asynchronously to avoid blocking response
      setImmediate(async () => {
        try {
          const biometricEvent = {
            member_id: null,
            biometric_id: null,
            event_type: eventType,
            device_id: deviceId || 'unknown',
            timestamp: timestamp || new Date().toISOString(),
            success: true,
            raw_data: JSON.stringify({
              ...eventData,
              ip_address: ip_address || req.ip,
              user_agent: req.get('User-Agent')
            })
          };
          
          await biometricIntegration.logBiometricEvent(biometricEvent);
          console.log(`✅ ESP32 heartbeat logged from device ${deviceId}`);
        } catch (error) {
          console.error(`❌ Error logging heartbeat from ${deviceId}:`, error);
        }
      });
      
      return; // Exit early for heartbeat events
    } else if (event === 'TimeLog') {
      if (status === 'authorized') {
        eventType = 'checkin'; // Could be checkin or checkout
        memberIdToUse = userId || memberId;
        biometricId = userId;
        
        // Find member by biometric ID for attendance logging
        if (biometricId) {
          const member = await biometricIntegration.findMemberByBiometricId(biometricId);
          if (member) {
            memberIdToUse = member.id;
            await biometricIntegration.logMemberAttendance(member, timestamp, eventData);
          }
        }
      } else if (status === 'unauthorized') {
        eventType = 'access_denied';
        success = false;
      } else if (status === 'button_override') {
        eventType = 'button_override';
        memberIdToUse = null;
        biometricId = null;
        success = true;
      } else if (status === 'remote_unlock') {
        eventType = 'remote_unlock';
        memberIdToUse = null;
        biometricId = null;
        success = true;
      }
    } else if (event === 'Enroll') {
      console.log(`🎯 Processing enrollment event: status=${status}, userId=${userId}, deviceId=${deviceId}`);
      
      // Handle enrollment progress messages
      if (status === 'enrollment_progress') {
        eventType = 'enrollment_progress';
        success = false; // Progress events should not mark as successful completion
        
        // Extract enrollment step from the message
        const { enrollmentStep } = eventData;
        console.log(`🔄 Processing enrollment progress: ${enrollmentStep} for user ${userId}`);
        
        // Since we now pass memberId as userId to ESP32, userId IS the member ID
        memberIdToUse = userId;
        biometricId = null; // No biometric_id until enrollment is actually complete
        
        try {
          // Get member name for better user experience
          let memberName = `Member ${userId}`;
          try {
            const memberResult = await pool.query('SELECT name FROM members WHERE id = ?', [userId]);
            if (memberResult.rows && memberResult.rows.length > 0) {
              memberName = memberResult.rows[0].name;
            }
          } catch (nameError) {
            console.warn('Could not fetch member name:', nameError.message);
          }
          
          console.log(`📤 Sending WebSocket progress update for member ${userId}: ${enrollmentStep}`);
          
          // Send WebSocket update to frontend for progress
          biometricIntegration.sendToWebSocketClients({
            type: 'enrollment_progress',
            status: 'progress',
            memberId: userId,
            memberName: memberName,
            currentStep: enrollmentStep,
            message: `Enrollment progress: ${enrollmentStep}`,
            deviceId: deviceId,
            timestamp: timestamp
          });
          
          console.log(`📤 Calling handleEnrollmentData for progress updates`);
          
          // Also call handleEnrollmentData for progress updates
          await biometricIntegration.handleEnrollmentData({
            userId: userId,
            memberId: userId,
            status: 'enrollment_progress',
            enrollmentStep: enrollmentStep,
            deviceId: deviceId,
            timestamp: timestamp
          });
          
          console.log(`✅ Enrollment progress updated for user ${userId}: ${enrollmentStep}`);
        } catch (progressError) {
          console.error('❌ Error updating enrollment progress:', progressError);
        }
        
      } else if (status === 'enrollment_success') {
        eventType = 'enrollment';
        success = true;
        
        // Since we now pass memberId as userId to ESP32, userId IS the member ID
        memberIdToUse = userId; // userId now directly represents the member ID
        biometricId = userId;   // Store the same ID as biometric_id for consistency
        
        // IMPORTANT: Update enrollment status in biometricIntegration service
        // This ensures the frontend knows enrollment is complete
        try {
          // Get member name for better user experience
          let memberName = `Member ${userId}`;
          try {
            const memberResult = await pool.query('SELECT name FROM members WHERE id = ?', [userId]);
            if (memberResult.rows && memberResult.rows.length > 0) {
              memberName = memberResult.rows[0].name;
            }
          } catch (nameError) {
            console.warn('Could not fetch member name:', nameError.message);
          }
          
          // Send WebSocket update to frontend immediately
          biometricIntegration.sendToWebSocketClients({
            type: 'enrollment_complete',
            status: 'success',
            memberId: userId,
            memberName: memberName,
            message: 'Enrollment completed successfully via ESP32',
            deviceId: deviceId,
            timestamp: timestamp
          });
          
          // Also call handleEnrollmentData for consistency
          await biometricIntegration.handleEnrollmentData({
            userId: userId,
            memberId: userId, // Pass the member ID (same as userId)
            status: 'enrollment_success',
            enrollmentStep: 'complete',
            deviceId: deviceId,
            timestamp: timestamp
          });
          
          // IMPORTANT: Stop enrollment mode if it's active for this member
          if (biometricIntegration.enrollmentMode && 
              biometricIntegration.enrollmentMode.active && 
              biometricIntegration.enrollmentMode.memberId == userId) {
            biometricIntegration.stopEnrollmentMode('success');
            console.log(`🛑 Enrollment mode stopped for member ${userId}`);
          }
          
          console.log(`✅ Enrollment status updated for user ${userId}`);
        } catch (enrollmentError) {
          console.error('❌ Error updating enrollment status:', enrollmentError);
        }
        
      } else if (status === 'enrollment_cancelled') {
        eventType = 'enrollment_cancelled';
        success = false;
        
        // Since we now pass memberId as userId to ESP32, userId IS the member ID
        memberIdToUse = userId;
        biometricId = null; // No biometric_id for cancelled enrollment
        
        // Update enrollment status for cancellation
        try {
          // Get member name for better user experience
          let memberName = `Member ${userId}`;
          try {
            const memberResult = await pool.query('SELECT name FROM members WHERE id = ?', [userId]);
            if (memberResult.rows && memberResult.rows.length > 0) {
              memberName = memberResult.rows[0].name;
            }
          } catch (nameError) {
            console.warn('Could not fetch member name:', nameError.message);
          }
          
          // Send WebSocket update to frontend immediately
          biometricIntegration.sendToWebSocketClients({
            type: 'enrollment_complete',
            status: 'cancelled',
            memberId: userId,
            memberName: memberName,
            message: 'Enrollment was cancelled via ESP32',
            deviceId: deviceId,
            timestamp: timestamp
          });
          
          // Also call handleEnrollmentData for consistency
          await biometricIntegration.handleEnrollmentData({
            userId: userId,
            memberId: userId, // Pass the member ID (same as userId)
            status: 'enrollment_cancelled',
            enrollmentStep: 'cancelled',
            deviceId: deviceId,
            timestamp: timestamp
          });
          
          // IMPORTANT: Stop enrollment mode if it's active for this member
          if (biometricIntegration.enrollmentMode && 
              biometricIntegration.enrollmentMode.active && 
              biometricIntegration.enrollmentMode.memberId == userId) {
            biometricIntegration.stopEnrollmentMode('cancelled');
            console.log(`🛑 Enrollment mode stopped for member ${userId}`);
          }
          
          console.log(`⏹️ Enrollment cancellation status updated for user ${userId}`);
        } catch (enrollmentError) {
          console.error('❌ Error updating enrollment cancellation status:', enrollmentError);
        }
        
      } else {
        eventType = 'enrollment_failed';
        success = false;
        
        // Since we now pass memberId as userId to ESP32, userId IS the member ID
        memberIdToUse = userId;
        biometricId = null; // No biometric_id for failed enrollment
        
        // Update enrollment status for failure
        try {
          // Get member name for better user experience
          let memberName = `Member ${userId}`;
          try {
            const memberResult = await pool.query('SELECT name FROM members WHERE id = ?', [userId]);
            if (memberResult.rows && memberResult.rows.length > 0) {
              memberName = memberResult.rows[0].name;
            }
          } catch (nameError) {
            console.warn('Could not fetch member name:', nameError.message);
          }
          
          // Send WebSocket update to frontend immediately
          biometricIntegration.sendToWebSocketClients({
            type: 'enrollment_complete',
            status: 'failed',
            memberId: userId,
            memberName: memberName,
            message: 'ESP32 enrollment failed',
            deviceId: deviceId,
            timestamp: timestamp
          });
          
          // Also call handleEnrollmentData for consistency
          await biometricIntegration.handleEnrollmentData({
            userId: userId,
            memberId: userId, // Pass the member ID (same as userId)
            status: 'enrollment_failed',
            enrollmentStep: 'failed',
            deviceId: deviceId,
            timestamp: timestamp,
            error: 'ESP32 enrollment failed'
          });
          
          // IMPORTANT: Stop enrollment mode if it's active for this member
          if (biometricIntegration.enrollmentMode && 
              biometricIntegration.enrollmentMode.active && 
              biometricIntegration.enrollmentMode.memberId == userId) {
            biometricIntegration.stopEnrollmentMode('failed');
            console.log(`🛑 Enrollment mode stopped for member ${userId}`);
          }
          
          console.log(`❌ Enrollment failure status updated for user ${userId}`);
        } catch (enrollmentError) {
          console.error('❌ Error updating enrollment failure status:', enrollmentError);
        }
      }
      
      // Update member's biometric_id ONLY when enrollment actually succeeds
      if (success && memberIdToUse && biometricId && eventType === 'enrollment') {
        try {
          await pool.query('UPDATE members SET biometric_id = ? WHERE id = ?', [biometricId, memberIdToUse]);
          console.log(`✅ Updated member ${memberIdToUse} with biometric_id ${biometricId}`);
        } catch (updateError) {
          console.error('❌ Failed to update member biometric_id:', updateError);
        }
      }
    }

    // Log the biometric event
    const biometricEvent = {
      member_id: memberIdToUse,
      biometric_id: biometricId,
      event_type: eventType,
      device_id: deviceId || 'unknown',
      timestamp: timestamp || new Date().toISOString(),
      success: success,
      raw_data: JSON.stringify({
        ...eventData,
        ip_address: ip_address || req.ip,
        user_agent: req.get('User-Agent'),
        reason: eventData.reason || null
      })
    };

    await biometricIntegration.logBiometricEvent(biometricEvent);

    console.log(`✅ ESP32 event logged: ${eventType} from device ${deviceId}`);

    // Send acknowledgment
    res.json({ 
      success: true, 
      message: `Event processed: ${eventType}`,
      device_id: deviceId,
      timestamp: timestamp
    });

  } catch (error) {
    console.error('❌ Error processing ESP32 webhook:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process ESP32 data',
      error: error.message 
    });
  }
};

// Fast validation endpoint for ESP32 devices
const validateBiometricId = async (req, res) => {
  try {
    const { biometricId, deviceId, timestamp } = req.body;
    
    console.log(`🔍 Validation request: biometricId=${biometricId}, deviceId=${deviceId}`);
    
    if (!biometricId) {
      return res.status(400).json({ 
        authorized: false,
        error: 'biometricId is required' 
      });
    }

    // Import payment validation utilities
    const { checkMemberPaymentStatus, getGracePeriodSetting } = require('../../utils/dateUtils');

    // Single optimized query for fast response with payment status
    const query = `
      SELECT 
        m.id as member_id,
        m.name,
        m.biometric_id,
        m.is_active,
        m.membership_plan_id,
        m.join_date,
        mp.name as plan_name,
        mp.duration_days,
        (SELECT MAX(p.payment_date) 
         FROM payments p 
         JOIN invoices i ON p.invoice_id = i.id 
         WHERE i.member_id = m.id) as last_payment_date
      FROM members m
      LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
      WHERE m.biometric_id = ?
    `;
    
    const result = await pool.query(query, [biometricId]);
    const member = result.rows[0];
    
    if (!member) {
      console.log(`❌ Member not found for biometric ID: ${biometricId}`);
      return res.json({ 
        authorized: false,
        memberId: null,
        reason: 'member_not_found'
      });
    }
    
    // Check if member is active
    if (member.is_active !== 1) {
      console.log(`❌ Member ${member.member_id} is inactive`);
      return res.json({ 
        authorized: false,
        memberId: member.member_id,
        reason: 'member_inactive'
      });
    }

    // Check payment status if member has a plan
    let paymentStatus = null;
    if (member.membership_plan_id && member.duration_days) {
      try {
        const gracePeriodDays = await getGracePeriodSetting(pool);
        paymentStatus = checkMemberPaymentStatus(
          {
            join_date: member.join_date,
            membership_plan_id: member.membership_plan_id
          },
          {
            duration_days: member.duration_days
          },
          member.last_payment_date,
          gracePeriodDays
        );

        // If grace period has expired, deny access
        if (paymentStatus.gracePeriodExpired) {
          console.log(`❌ Member ${member.member_id} payment grace period expired (${paymentStatus.daysOverdue} days overdue)`);
          
          // Automatically deactivate the member
          try {
            await pool.query('UPDATE members SET is_active = 0 WHERE id = ?', [member.member_id]);
            console.log(`🔄 Automatically deactivated member ${member.member_id} due to expired grace period`);
            
            // Trigger ESP32 cache invalidation
            try {
              if (invalidateESP32Cache) {
                await invalidateESP32Cache();
              }
            } catch (cacheError) {
              console.error('❌ Error invalidating ESP32 cache:', cacheError);
            }
          } catch (deactivationError) {
            console.error('❌ Error deactivating member:', deactivationError);
          }
          
          return res.json({ 
            authorized: false,
            memberId: member.member_id,
            reason: 'payment_overdue_grace_expired',
            daysOverdue: paymentStatus.daysOverdue,
            gracePeriodExpired: true
          });
        }
      } catch (paymentError) {
        console.error('❌ Error checking payment status:', paymentError);
        // Continue with authorization if payment check fails
      }
    }
    
    const isAuthorized = member.is_active === 1;
    
    console.log(`✅ Validation result: memberId=${member.member_id}, authorized=${isAuthorized}`);
    
    // Send minimal response for speed
    res.json({ 
      authorized: isAuthorized,
      memberId: member.member_id,
      isActive: member.is_active,
      planName: member.plan_name,
      paymentStatus: paymentStatus
    });
    
  } catch (error) {
    console.error('❌ Error validating biometric ID:', error);
    res.status(500).json({ 
      authorized: false,
      error: 'validation_failed'
    });
  }
};

// Cache update endpoint for ESP32 devices
const updateMemberCache = async (req, res) => {
  try {
    const { deviceId, event, timestamp } = req.body;
    
    console.log(`🔄 Cache update request from device: ${deviceId}`);
    
    if (!deviceId) {
      return res.status(400).json({ 
        success: false,
        error: 'deviceId is required' 
      });
    }

    // Get all members with biometric IDs
    const query = `
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
    `;
    
    const result = await pool.query(query);
    const members = result.rows;
    
    // Format members for ESP32 cache
    const cacheMembers = members.map(member => ({
      biometricId: parseInt(member.biometric_id),
      memberId: member.member_id,
      authorized: member.is_active === 1,
      planName: member.plan_name,
      membershipPlanId: member.membership_plan_id
    }));
    
    console.log(`✅ Sending cache update: ${cacheMembers.length} members to device ${deviceId}`);
    
    res.json({ 
      success: true,
      members: cacheMembers,
      totalMembers: cacheMembers.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error updating member cache:', error);
    res.status(500).json({ 
      success: false,
      error: 'cache_update_failed'
    });
  }
};

// Cache invalidation function to trigger immediate ESP32 cache updates
const invalidateESP32Cache = async () => {
  try {
    console.log('🔄 Triggering immediate ESP32 cache invalidation...');
    
    // Get all registered ESP32 devices
    const devicesQuery = `
      SELECT device_id, device_name, last_heartbeat 
      FROM devices 
      WHERE device_type = 'esp32_door_lock'
      AND status = 'online'
      AND last_heartbeat > datetime('now', '-1 hour')
    `;
    
    const devices = await pool.query(devicesQuery);
    
    if (devices.rows.length === 0) {
      console.log('⚠️ No active ESP32 devices found for cache invalidation');
      return;
    }
    
    console.log(`📡 Found ${devices.rows.length} active ESP32 devices for cache invalidation`);
    
    // For each device, we'll send a cache invalidation signal
    // The ESP32 devices will detect this and refresh their cache immediately
    for (const device of devices.rows) {
      try {
        console.log(`🔄 Invalidating cache for device: ${device.device_name} (${device.device_id})`);
        
        // Send cache invalidation request to ESP32 device
        const axios = require('axios');
        const deviceUrl = `http://${device.device_id}/api/cache/invalidate`;
        
        await axios.post(deviceUrl, {
          reason: 'member_status_change',
          timestamp: new Date().toISOString()
        }, {
          timeout: 5000 // 5 second timeout
        });
        
        console.log(`✅ Cache invalidation sent to device: ${device.device_name}`);
        
      } catch (deviceError) {
        console.error(`❌ Failed to invalidate cache for device ${device.device_name}:`, deviceError.message);
        // Continue with other devices even if one fails
      }
    }
    
    console.log('✅ ESP32 cache invalidation process completed');
    
  } catch (error) {
    console.error('❌ Error during ESP32 cache invalidation:', error);
    throw error;
  }
};

module.exports = {
  setBiometricIntegration,
  getMemberBiometricStatus,
  getMemberBiometricDetails,
  startEnrollment,
  stopEnrollment,
  cancelEnrollment,
  removeBiometricData,
  manualEnrollment,
  getEnrollmentStatus,
  getBiometricEvents,
  getSystemStatus,
  getMembersWithoutBiometric,
  getMembersWithBiometric,
  testConnection,
  // ESP32 specific endpoints
  unlockDoorRemotely,
  startRemoteEnrollment,
  getDeviceStatus,
  getAllDevices,
  esp32Webhook,
  // Hybrid cache endpoints
  validateBiometricId,
  updateMemberCache,
  // Cache invalidation
  invalidateESP32Cache
};
