const { pool } = require('../../config/sqlite');

// Get reference to biometric integration instance
let biometricIntegration = null;

const setBiometricIntegration = (integration) => {
  biometricIntegration = integration;
};

// Get biometric status for a member
const getMemberBiometricStatus = async (req, res) => {
  try {
    const { memberId } = req.params;
    
    if (!biometricIntegration) {
      return res.status(503).json({ 
        success: false, 
        message: 'Biometric service not available' 
      });
    }

    const status = await biometricIntegration.getMemberBiometricStatus(parseInt(memberId));
    
    if (!status) {
      return res.status(404).json({ 
        success: false, 
        message: 'Member not found' 
      });
    }

    res.json({ 
      success: true, 
      data: status 
    });
  } catch (error) {
    console.error('Error getting member biometric status:', error);
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
    const memberResult = await pool.query('SELECT id, name, biometric_id, biometric_sensor_member_id FROM members WHERE id = ?', [memberId]);
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

    const result = biometricIntegration.stopEnrollmentMode('manual');
    
    if (!result) {
      return res.status(400).json({ 
        success: false, 
        message: 'No active enrollment session' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Enrollment stopped',
      data: result 
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

// Get biometric events/logs
const getBiometricEvents = async (req, res) => {
  try {
    const { memberId } = req.query;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    let query = `
      SELECT be.*, m.name as member_name 
      FROM biometric_events be
      LEFT JOIN members m ON be.member_id = m.id
    `;
    let params = [];

    if (memberId) {
      query += ' WHERE be.member_id = ?';
      params.push(memberId);
    }

    query += ' ORDER BY be.timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const eventsResult = await pool.query(query, params);
    const events = eventsResult.rows || [];

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM biometric_events';
    let countParams = [];

    if (memberId) {
      countQuery += ' WHERE member_id = ?';
      countParams.push(memberId);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = countResult.rows[0]?.total || 0;

    res.json({ 
      success: true, 
      data: {
        events,
        total: totalCount,
        limit,
        offset
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
      status.connectedDevices = biometricIntegration.listener.clients.size;
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

// Get members without biometric data
const getMembersWithoutBiometric = async (req, res) => {
  try {
    const query = `
      SELECT id, name, email, phone, join_date 
      FROM members 
      WHERE (biometric_id IS NULL OR biometric_id = '') AND is_active = 1
      ORDER BY name ASC
    `;

    const result = await pool.query(query);
    const members = result.rows || [];

    console.log(`Found ${members.length} members without biometric data`);

    res.json({ 
      success: true, 
      data: members 
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

    // If no specific host/port, test existing connected devices
    const testMessage = 'TEST:CONNECTION:' + new Date().toISOString();
    biometricIntegration.listener.broadcast(testMessage);

    res.json({ 
      success: true, 
      message: 'Test message sent to connected devices',
      data: {
        connectedDevices: biometricIntegration.listener.clients.size,
        testMessage
      }
    });
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
    const { deviceUserId, sensorMemberId } = req.body;
    
    if (!deviceUserId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Device User ID is required' 
      });
    }

    // Validate sensor member ID if provided
    if (sensorMemberId && typeof sensorMemberId !== 'string') {
      return res.status(400).json({ 
        success: false, 
        message: 'Sensor Member ID must be a string' 
      });
    }

    // Get member details
    const memberResult = await pool.query('SELECT id, name, biometric_id, biometric_sensor_member_id FROM members WHERE id = ?', [memberId]);
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

    // Assign device user ID and sensor member ID to member
    await pool.query('UPDATE members SET biometric_id = ?, biometric_sensor_member_id = ? WHERE id = ?', [deviceUserId, sensorMemberId || null, memberId]);

    // Log enrollment event
    if (biometricIntegration) {
      const enrollmentEvent = {
        member_id: memberId,
        biometric_id: deviceUserId,
        sensor_member_id: sensorMemberId || null,
        event_type: 'manual_enrollment',
        device_id: 'manual',
        timestamp: new Date().toISOString(),
        success: true,
        raw_data: JSON.stringify({ method: 'manual', deviceUserId, sensorMemberId })
      };

      await biometricIntegration.logBiometricEvent(enrollmentEvent);
    }
    
    res.json({ 
      success: true, 
      message: `Device User ID ${deviceUserId} successfully assigned to ${member.name}`,
      data: {
        memberId: memberId,
        memberName: member.name,
        deviceUserId: deviceUserId,
        sensorMemberId: sensorMemberId || null
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
      'SELECT id, name, email, phone, biometric_id, biometric_sensor_member_id FROM members WHERE id = ?', 
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
        id, member_id, biometric_id, sensor_member_id, event_type, 
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
        biometric_sensor_member_id: member.biometric_sensor_member_id,
        has_biometric_data: !!member.biometric_id
      },
      events: eventsResult.rows || [],
      summary: {
        total_events: eventsResult.rows?.length || 0,
        device_user_id: member.biometric_id,
        sensor_member_id: member.biometric_sensor_member_id,
        ids_match: member.biometric_id === member.biometric_sensor_member_id,
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

module.exports = {
  setBiometricIntegration,
  getMemberBiometricStatus,
  getMemberBiometricDetails,
  startEnrollment,
  stopEnrollment,
  removeBiometricData,
  manualEnrollment,
  getEnrollmentStatus,
  getBiometricEvents,
  getSystemStatus,
  getMembersWithoutBiometric,
  testConnection,
  // ESP32 specific endpoints
  unlockDoorRemotely,
  startRemoteEnrollment,
  getDeviceStatus,
  getAllDevices
};
