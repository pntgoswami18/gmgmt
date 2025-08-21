const BiometricListener = require('./biometricListener');
const { pool } = require('../config/sqlite');

class BiometricIntegration {
  constructor(port = 8080) {
    this.listener = new BiometricListener(port);
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Handle successful access
    this.listener.on('accessGranted', async (biometricData) => {
      console.log('Access granted for:', biometricData);
      await this.handleAccessGranted(biometricData);
    });

    // Handle denied access
    this.listener.on('accessDenied', (biometricData) => {
      console.log('Access denied for:', biometricData);
      this.handleAccessDenied(biometricData);
    });

    // Handle enrollment data
    this.listener.on('enrollmentData', async (biometricData) => {
      console.log('Enrollment data received:', biometricData);
      await this.handleEnrollmentData(biometricData);
    });

    // Handle unknown messages
    this.listener.on('unknownMessage', (biometricData) => {
      console.log('Unknown biometric message:', biometricData);
    });

    // Handle connection events
    this.listener.on('deviceConnected', (socket) => {
      console.log('Biometric device connected:', socket.remoteAddress);
    });

    this.listener.on('deviceDisconnected', () => {
      console.log('Biometric device disconnected');
    });

    // Handle errors
    this.listener.on('error', (error) => {
      console.error('Biometric listener error:', error);
    });
  }

  async handleAccessGranted(biometricData) {
    try {
      const { userId, memberId, timestamp } = biometricData;
      
      console.log(`🔓 Access granted - Biometric data received:`);
      console.log(`   - User ID: ${userId}`);
      console.log(`   - Member ID: ${memberId || 'Not provided'}`);
      console.log(`   - Raw data:`, JSON.stringify(biometricData, null, 2));
      
      // Find member using both sensor member ID and device user ID
      const { member, identificationMethod } = await this.findMemberByAnyBiometricId(userId, memberId);
      
      if (member) {
        console.log(`👤 Member identified using: ${identificationMethod}`);
        
        // Log attendance with identification method info
        await this.logMemberAttendance(member, timestamp, identificationMethod, biometricData);
        
        // Check if member has active plan
        if (await this.hasActivePlan(member)) {
          console.log(`✅ Access granted: ${member.name} (ID: ${member.id}) via ${identificationMethod}`);
          
          // You can add additional actions here:
          // - Send welcome message to display
          // - Log entry in access log
          // - Trigger door unlock signal
          // - Update member's last visit
          
          await this.updateLastVisit(member);
          this.notifyAccessGranted(member, biometricData);
        } else {
          console.log(`❌ Member ${member.name} has no active plan`);
          this.notifyPlanExpired(member, biometricData);
        }
      } else {
        console.log(`❌ Unknown biometric - User ID: ${userId}, Sensor Member ID: ${memberId || 'Not provided'}`);
        this.notifyUnknownUser(biometricData);
      }
    } catch (error) {
      console.error('Error handling access granted:', error);
    }
  }

  handleAccessDenied(biometricData) {
    console.log('Biometric authentication failed:', biometricData);
    
    // Log failed attempt
    this.logFailedAttempt(biometricData);
    
    // You can add security measures here:
    // - Take photo if camera is available
    // - Send alert to admin
    // - Log security event
  }

  async findMemberByBiometricId(biometricId) {
    try {
      // This assumes you have a biometric_id field in your members table
      // You may need to modify your member model to include this field
      const query = 'SELECT * FROM members WHERE biometric_id = ?';
      const result = await pool.query(query, [biometricId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error finding member by biometric ID:', error);
      return null;
    }
  }

  async findMemberBySensorId(sensorMemberId) {
    try {
      // Look up member by sensor member ID
      const query = 'SELECT * FROM members WHERE biometric_sensor_member_id = ?';
      const result = await pool.query(query, [sensorMemberId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error finding member by sensor member ID:', error);
      return null;
    }
  }

  async findMemberByAnyBiometricId(userId, sensorMemberId) {
    try {
      let member = null;
      let identificationMethod = null;

      // Priority 1: Try sensor member ID first (if provided and different from userId)
      if (sensorMemberId && sensorMemberId !== userId) {
        console.log(`🔍 Trying to find member by sensor member ID: ${sensorMemberId}`);
        member = await this.findMemberBySensorId(sensorMemberId);
        if (member) {
          identificationMethod = 'sensor_member_id';
          console.log(`✅ Member found by sensor member ID: ${member.name} (ID: ${member.id})`);
        }
      }

      // Priority 2: Try device user ID (biometric_id) if sensor ID didn't work
      if (!member && userId) {
        console.log(`🔍 Trying to find member by device user ID: ${userId}`);
        member = await this.findMemberByBiometricId(userId);
        if (member) {
          identificationMethod = 'device_user_id';
          console.log(`✅ Member found by device user ID: ${member.name} (ID: ${member.id})`);
        }
      }

      // Priority 3: If sensor member ID is same as user ID, try it anyway
      if (!member && sensorMemberId && sensorMemberId === userId) {
        console.log(`🔍 Sensor member ID same as user ID, already tried: ${sensorMemberId}`);
      }

      if (!member) {
        console.log(`❌ No member found for user ID: ${userId}, sensor member ID: ${sensorMemberId || 'Not provided'}`);
      }

      return {
        member,
        identificationMethod
      };
    } catch (error) {
      console.error('Error finding member by any biometric ID:', error);
      return { member: null, identificationMethod: null };
    }
  }

  async logMemberAttendance(member, timestamp, identificationMethod = null, biometricData = null) {
    try {
      const now = timestamp ? new Date(timestamp) : new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toISOString();

      // Enhanced logging with identification method
      const idMethodText = identificationMethod ? ` (identified via ${identificationMethod})` : '';
      const sensorMemberId = biometricData?.memberId || 'N/A';
      const deviceUserId = biometricData?.userId || 'N/A';

      // Check if member already checked in today
      const existingCheckIn = await this.getTodayCheckIn(member.id, dateStr);
      
      if (existingCheckIn && !existingCheckIn.check_out_time) {
        // Member is checking out
        await this.checkOutMember(existingCheckIn.id, timeStr);
        console.log(`✅ ${member.name} checked OUT at ${now.toLocaleTimeString()}${idMethodText}`);
        console.log(`   📊 Biometric IDs - Device: ${deviceUserId}, Sensor: ${sensorMemberId}`);
        this.notifyCheckOut(member, now);
        
        // Log biometric event for checkout
        if (biometricData) {
          await this.logBiometricEvent({
            member_id: member.id,
            biometric_id: biometricData.userId,
            sensor_member_id: biometricData.memberId,
            event_type: 'checkout',
            device_id: biometricData.deviceId || 'unknown',
            timestamp: timeStr,
            success: true,
            raw_data: JSON.stringify({ 
              ...biometricData, 
              identificationMethod,
              action: 'checkout'
            })
          });
        }
      } else if (!existingCheckIn) {
        // Member is checking in for the first time today
        const attendanceData = {
          member_id: member.id,
          check_in_time: timeStr,
          date: dateStr
        };
        
        await this.createAttendanceRecord(attendanceData);
        console.log(`✅ ${member.name} checked IN at ${now.toLocaleTimeString()}${idMethodText}`);
        console.log(`   📊 Biometric IDs - Device: ${deviceUserId}, Sensor: ${sensorMemberId}`);
        this.notifyCheckIn(member, now);
        
        // Log biometric event for checkin
        if (biometricData) {
          await this.logBiometricEvent({
            member_id: member.id,
            biometric_id: biometricData.userId,
            sensor_member_id: biometricData.memberId,
            event_type: 'checkin',
            device_id: biometricData.deviceId || 'unknown',
            timestamp: timeStr,
            success: true,
            raw_data: JSON.stringify({ 
              ...biometricData, 
              identificationMethod,
              action: 'checkin'
            })
          });
        }
      } else {
        // Member already completed their session today
        console.log(`ℹ️ ${member.name} already completed their session today${idMethodText}`);
        console.log(`   📊 Biometric IDs - Device: ${deviceUserId}, Sensor: ${sensorMemberId}`);
        this.notifyAlreadyCompleted(member);
        
        // Log biometric event for already completed
        if (biometricData) {
          await this.logBiometricEvent({
            member_id: member.id,
            biometric_id: biometricData.userId,
            sensor_member_id: biometricData.memberId,
            event_type: 'already_completed',
            device_id: biometricData.deviceId || 'unknown',
            timestamp: timeStr,
            success: true,
            raw_data: JSON.stringify({ 
              ...biometricData, 
              identificationMethod,
              action: 'already_completed'
            })
          });
        }
      }
    } catch (error) {
      console.error('Error logging attendance:', error);
    }
  }

  async getTodayCheckIn(memberId, date) {
    try {
      const query = 'SELECT * FROM attendance WHERE member_id = ? AND date = ? ORDER BY check_in_time DESC LIMIT 1';
      const result = await pool.query(query, [memberId, date]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting today check-in:', error);
      return null;
    }
  }

  async createAttendanceRecord(attendanceData) {
    try {
      const query = `
        INSERT INTO attendance (member_id, check_in_time, date)
        VALUES (?, ?, ?)
      `;
      
      const result = await pool.query(query, [attendanceData.member_id, attendanceData.check_in_time, attendanceData.date]);
      return result.lastInsertId;
    } catch (error) {
      console.error('Error creating attendance record:', error);
      throw error;
    }
  }

  async checkOutMember(attendanceId, checkOutTime) {
    try {
      const query = 'UPDATE attendance SET check_out_time = ? WHERE id = ?';
      await pool.query(query, [checkOutTime, attendanceId]);
      return;
    } catch (error) {
      console.error('Error checking out member:', error);
      throw error;
    }
  }

  async hasActivePlan(member) {
    try {
      // Check if member has an active plan
      // This logic depends on your plan/subscription structure
      const query = `
        SELECT * FROM member_plans 
        WHERE member_id = ? 
        AND start_date <= date('now') 
        AND end_date >= date('now')
        AND status = 'active'
      `;
      
      const result = await pool.query(query, [member.id]);
      return !!(result.rows && result.rows[0]);
    } catch (error) {
      console.error('Error checking active plan:', error);
      return false;
    }
  }

  async updateLastVisit(member) {
    try {
      const query = 'UPDATE members SET last_visit = ? WHERE id = ?';
      await pool.query(query, [new Date().toISOString(), member.id]);
      return;
    } catch (error) {
      console.error('Error updating last visit:', error);
    }
  }

  notifyCheckIn(member, timestamp) {
    const timeStr = timestamp.toLocaleTimeString();
    const message = `WELCOME:${member.name}:IN:${timeStr}`;
    this.listener.broadcast(message);
    console.log(`🔓 ${member.name} checked IN at ${timeStr}`);
  }

  notifyCheckOut(member, timestamp) {
    const timeStr = timestamp.toLocaleTimeString();
    const message = `GOODBYE:${member.name}:OUT:${timeStr}`;
    this.listener.broadcast(message);
    console.log(`🔒 ${member.name} checked OUT at ${timeStr}`);
  }

  notifyAlreadyCompleted(member) {
    const message = `COMPLETED:${member.name}`;
    this.listener.broadcast(message);
    console.log(`ℹ️ ${member.name} already completed today's session`);
  }

  notifyAccessGranted(member, biometricData) {
    // Send success signal back to device or display
    const message = `WELCOME:${member.name}`;
    this.listener.broadcast(message);
    
    // You could also emit events for your frontend to show notifications
    console.log(`✅ Access granted: ${member.name}`);
  }

  notifyPlanExpired(member, biometricData) {
    const message = `PLAN_EXPIRED:${member.name}`;
    this.listener.broadcast(message);
    console.log(`❌ Plan expired: ${member.name}`);
  }

  notifyUnknownUser(biometricData) {
    const message = 'UNKNOWN_USER';
    this.listener.broadcast(message);
    console.log(`❌ Unknown user: ${biometricData.userId}`);
  }

  logFailedAttempt(biometricData) {
    // Log failed biometric attempts for security
    console.log('🔒 Failed biometric attempt:', biometricData);
    
    // You could store this in a security log table
    const securityLog = {
      event_type: 'biometric_failure',
      timestamp: new Date().toISOString(),
      details: JSON.stringify(biometricData)
    };
    
    // Save to security_logs table if you have one
  }

  start() {
    console.log('Starting biometric integration...');
    this.listener.start();
  }

  stop() {
    console.log('Stopping biometric integration...');
    this.listener.stop();
  }

  // Enrollment functionality
  startEnrollmentMode(memberId, memberName) {
    console.log(`🎯 Starting enrollment mode for ${memberName} (ID: ${memberId})`);
    this.enrollmentMode = {
      active: true,
      memberId,
      memberName,
      startTime: new Date(),
      attempts: 0,
      maxAttempts: 3
    };

    // Send enrollment command to device
    const enrollCommand = `ENROLL:${memberId}:${memberName}`;
    this.listener.broadcast(enrollCommand);
    
    // Set timeout for enrollment mode
    this.enrollmentTimeout = setTimeout(() => {
      this.stopEnrollmentMode('timeout');
    }, 60000); // 1 minute timeout

    return this.enrollmentMode;
  }

  stopEnrollmentMode(reason = 'manual') {
    if (this.enrollmentMode && this.enrollmentMode.active) {
      console.log(`🛑 Stopping enrollment mode: ${reason}`);
      this.enrollmentMode.active = false;
      
      if (this.enrollmentTimeout) {
        clearTimeout(this.enrollmentTimeout);
        this.enrollmentTimeout = null;
      }

      // Send stop enrollment command to device
      this.listener.broadcast('ENROLL:STOP');
      
      const result = { ...this.enrollmentMode, endReason: reason };
      this.enrollmentMode = null;
      return result;
    }
    return null;
  }

  async handleEnrollmentData(biometricData) {
    if (!this.enrollmentMode || !this.enrollmentMode.active) {
      console.log('❌ Received enrollment data but enrollment mode is not active');
      return false;
    }

    try {
      this.enrollmentMode.attempts++;
      
      const { userId, status, enrollmentStep } = biometricData;
      
      if (status === 'enrollment_success' || status === 'enrolled') {
        // Enrollment successful
        await this.saveBiometricEnrollment(this.enrollmentMode.memberId, userId, biometricData);
        console.log(`✅ Enrollment successful for ${this.enrollmentMode.memberName}`);
        
        this.listener.broadcast(`ENROLL:SUCCESS:${this.enrollmentMode.memberName}`);
        this.stopEnrollmentMode('success');
        return true;
        
      } else if (status === 'enrollment_failed' || status === 'error') {
        // Enrollment failed
        console.log(`❌ Enrollment failed for ${this.enrollmentMode.memberName}: ${biometricData.error || 'Unknown error'}`);
        
        if (this.enrollmentMode.attempts >= this.enrollmentMode.maxAttempts) {
          this.listener.broadcast(`ENROLL:FAILED:MAX_ATTEMPTS`);
          this.stopEnrollmentMode('max_attempts');
          return false;
        } else {
          this.listener.broadcast(`ENROLL:RETRY:${this.enrollmentMode.maxAttempts - this.enrollmentMode.attempts}`);
          return false;
        }
        
      } else if (status === 'enrollment_progress' || enrollmentStep) {
        // Enrollment in progress
        console.log(`🔄 Enrollment progress for ${this.enrollmentMode.memberName}: ${enrollmentStep || 'in progress'}`);
        this.listener.broadcast(`ENROLL:PROGRESS:${enrollmentStep || 'scanning'}`);
        return false;
      }
      
      return false;
    } catch (error) {
      console.error('Error handling enrollment data:', error);
      this.listener.broadcast('ENROLL:ERROR');
      this.stopEnrollmentMode('error');
      return false;
    }
  }

  async saveBiometricEnrollment(memberId, biometricId, enrollmentData) {
    try {
      // Extract sensor member ID from enrollment data 
      // Priority: memberId (if device sends it) -> userId -> biometricId as fallback
      const sensorMemberId = enrollmentData.memberId || enrollmentData.userId || biometricId || null;
      
      console.log(`📋 Storing biometric enrollment for member ${memberId}:`);
      console.log(`   - Device User ID (biometric_id): ${biometricId}`);
      console.log(`   - Sensor Member ID (from device): ${sensorMemberId}`);
      console.log(`   - Raw enrollment data:`, JSON.stringify(enrollmentData, null, 2));
      
      // Update member with biometric ID and sensor member ID
      const updateMemberQuery = 'UPDATE members SET biometric_id = ?, biometric_sensor_member_id = ? WHERE id = ?';
      await pool.query(updateMemberQuery, [biometricId, sensorMemberId, memberId]);

      // Log enrollment event
      const enrollmentEvent = {
        member_id: memberId,
        biometric_id: biometricId,
        sensor_member_id: sensorMemberId,
        event_type: 'enrollment',
        device_id: enrollmentData.deviceId || 'unknown',
        timestamp: new Date().toISOString(),
        success: true,
        raw_data: JSON.stringify(enrollmentData)
      };

      await this.logBiometricEvent(enrollmentEvent);
      
      console.log(`💾 Biometric enrollment saved for member ${memberId}`);
      return true;
    } catch (error) {
      console.error('Error saving biometric enrollment:', error);
      throw error;
    }
  }

  async logBiometricEvent(eventData) {
    try {
      const query = `
        INSERT INTO biometric_events (
          member_id, biometric_id, sensor_member_id, event_type, device_id, 
          timestamp, success, error_message, raw_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const result = await pool.query(query, [
        eventData.member_id,
        eventData.biometric_id,
        eventData.sensor_member_id || null,
        eventData.event_type,
        eventData.device_id,
        eventData.timestamp,
        eventData.success ? 1 : 0,
        eventData.error_message || null,
        eventData.raw_data
      ]);
      return result.lastInsertId;
    } catch (error) {
      console.error('Error logging biometric event:', error);
      throw error;
    }
  }

  async removeBiometricId(memberId) {
    try {
      const query = 'UPDATE members SET biometric_id = NULL, biometric_sensor_member_id = NULL WHERE id = ?';
      await pool.query(query, [memberId]);

      // Log removal event
      await this.logBiometricEvent({
        member_id: memberId,
        biometric_id: null,
        sensor_member_id: null,
        event_type: 'removal',
        device_id: 'admin',
        timestamp: new Date().toISOString(),
        success: true,
        raw_data: JSON.stringify({ action: 'biometric_removal' })
      });

      console.log(`🗑️ Biometric ID removed for member ${memberId}`);
      return true;
    } catch (error) {
      console.error('Error removing biometric ID:', error);
      throw error;
    }
  }

  async getMemberBiometricStatus(memberId) {
    try {
      const query = 'SELECT id, name, biometric_id, biometric_sensor_member_id FROM members WHERE id = ?';
      
      const memberResult = await pool.query(query, [memberId]);
      const member = memberResult.rows[0];

      if (!member) {
        return null;
      }

      // Get enrollment history
      const historyQuery = `
        SELECT * FROM biometric_events 
        WHERE member_id = ? 
        ORDER BY timestamp DESC 
        LIMIT 10
      `;

      const historyResult = await pool.query(historyQuery, [memberId]);
      const history = historyResult.rows || [];

      return {
        member,
        hasFingerprint: !!member.biometric_id,
        biometricId: member.biometric_id,
        sensorMemberId: member.biometric_sensor_member_id,
        enrollmentHistory: history
      };
    } catch (error) {
      console.error('Error getting member biometric status:', error);
      return null;
    }
  }
}

module.exports = BiometricIntegration;
