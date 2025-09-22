const { pool } = require('../../config/sqlite');

// This endpoint would be called by the biometric device
const performCheckIn = async (resolvedMemberId, res) => {
    if (resolvedMemberId === undefined || resolvedMemberId === null) {
        return res.status(400).json({ message: 'A valid memberId is required to check in.' });
    }
    // Validate member exists and is active
    const member = await pool.query('SELECT id, is_active FROM members WHERE id = $1', [resolvedMemberId]);
    if (member.rows.length === 0) {
        return res.status(404).json({ message: 'Member not found' });
    }
    if (String(member.rows[0].is_active) === '0') {
        return res.status(403).json({ message: 'Member is deactivated and cannot check in.' });
    }

    // Enforce configured session windows
    const settingsRes = await pool.query(`
        SELECT key, value FROM settings WHERE key IN (
            'morning_session_start','morning_session_end','evening_session_start','evening_session_end','cross_session_checkin_restriction'
        )
    `);
    const settingsMap = Object.fromEntries(settingsRes.rows.map(r => [r.key, r.value]));
    
    // Check if cross-session restriction is enabled
    const crossSessionRestrictionEnabled = settingsMap.cross_session_checkin_restriction === 'true' || settingsMap.cross_session_checkin_restriction === true;
    const parseTimeToMinutes = (hhmm) => {
        const [h, m] = String(hhmm || '00:00').split(':').map(Number);
        return (h * 60) + (m || 0);
    };
    const MORNING_START_MINUTES = parseTimeToMinutes(settingsMap.morning_session_start || '05:00');
    const MORNING_END_MINUTES = parseTimeToMinutes(settingsMap.morning_session_end || '11:00');
    const EVENING_START_MINUTES = parseTimeToMinutes(settingsMap.evening_session_start || '16:00');
    const EVENING_END_MINUTES = parseTimeToMinutes(settingsMap.evening_session_end || '22:00');

    const now = new Date();
    const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
    const isInMorningSession = minutesSinceMidnight >= MORNING_START_MINUTES && minutesSinceMidnight <= MORNING_END_MINUTES;
    const isInEveningSession = minutesSinceMidnight >= EVENING_START_MINUTES && minutesSinceMidnight <= EVENING_END_MINUTES;

    if (!isInMorningSession && !isInEveningSession) {
        return res.status(400).json({ message: `Check-in allowed only during Morning (${settingsMap.morning_session_start || '05:00'}-${settingsMap.morning_session_end || '11:00'}) or Evening (${settingsMap.evening_session_start || '16:00'}-${settingsMap.evening_session_end || '22:00'}) sessions.` });
    }

    // Prevent cross-session check-ins (unless admin and restriction is enabled)
    const memberCheck = await pool.query('SELECT is_admin FROM members WHERE id = $1', [resolvedMemberId]);
    const isAdmin = memberCheck.rows[0]?.is_admin === 1;
    
    if (!isAdmin && crossSessionRestrictionEnabled) {
        // Check if member has already checked in during any session today
        const todayCheckIns = await pool.query(
            `SELECT check_in_time FROM attendance 
             WHERE member_id = $1 AND DATE(check_in_time) = DATE('now') 
             ORDER BY check_in_time DESC`,
            [resolvedMemberId]
        );

        if (todayCheckIns.rowCount > 0) {
            // Check which session the existing check-in was in
            const existingCheckInTime = new Date(todayCheckIns.rows[0].check_in_time);
            const existingMinutesSinceMidnight = existingCheckInTime.getHours() * 60 + existingCheckInTime.getMinutes();
            
            const existingWasMorning = existingMinutesSinceMidnight >= MORNING_START_MINUTES && existingMinutesSinceMidnight <= MORNING_END_MINUTES;
            const existingWasEvening = existingMinutesSinceMidnight >= EVENING_START_MINUTES && existingMinutesSinceMidnight <= EVENING_END_MINUTES;
            
            // Determine current session
            const currentIsMorning = isInMorningSession;
            const currentIsEvening = isInEveningSession;
            
            // Prevent cross-session check-ins
            if ((existingWasMorning && currentIsEvening) || (existingWasEvening && currentIsMorning)) {
                const existingSession = existingWasMorning ? 'morning' : 'evening';
                const currentSession = currentIsMorning ? 'morning' : 'evening';
                return res.status(409).json({ 
                    message: `Member has already checked in during the ${existingSession} session today. Cannot check in during ${currentSession} session.` 
                });
            }
        }
    }

    await pool.query(
        "INSERT INTO attendance (member_id, check_in_time) VALUES ($1, datetime('now','localtime'))",
        [resolvedMemberId]
    );
    const newAttendance = await pool.query('SELECT * FROM attendance WHERE member_id = $1 ORDER BY id DESC LIMIT 1', [resolvedMemberId]);

    return res.status(200).json({ 
        message: `Member ${resolvedMemberId} checked in successfully.`,
        attendance: newAttendance.rows[0]
    });
};

exports.checkIn = async (req, res) => {
    const { memberId, device_user_id } = req.body; // from app or device gateway
    if (memberId === undefined && !device_user_id) {
        return res.status(400).json({ message: 'Member ID or device_user_id is required.' });
    }

    try {
        let resolvedMemberId = undefined;

        if (memberId !== undefined) {
            const numeric = Number(memberId);
            if (Number.isFinite(numeric) && Number.isInteger(numeric) && numeric > 0) {
                resolvedMemberId = numeric;
            } else {
                return res.status(400).json({ message: 'memberId must be a positive integer.' });
            }
        }

        if (resolvedMemberId === undefined && device_user_id) {
            const map = await pool.query('SELECT member_id FROM member_biometrics WHERE device_user_id = $1', [device_user_id]);
            if (map.rowCount > 0) {
                resolvedMemberId = map.rows[0].member_id;
            } else {
                return res.status(404).json({ message: 'No member linked to this device user id' });
            }
        }

        await performCheckIn(resolvedMemberId, res);
    } catch (err) {
        res.status(500).json({ message: err.message || 'Internal server error' });
    }
};

// Device webhook compatible with ESP32 device formats
exports.deviceWebhook = async (req, res) => {
    try {
        const deviceUserId = req.body?.device_user_id || req.body?.userId || req.body?.UserID || req.body?.EmpCode || req.body?.emp_code;
        if (!deviceUserId) {
            return res.status(400).json({ message: 'device_user_id is required' });
        }
        const map = await pool.query('SELECT member_id FROM member_biometrics WHERE device_user_id = $1', [deviceUserId]);
        if (map.rowCount === 0) {
            return res.status(404).json({ message: 'No member linked to this device user id' });
        }
        const memberId = map.rows[0].member_id;
        await performCheckIn(memberId, res);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get attendance records for a specific member
exports.getAttendanceByMember = async (req, res) => {
    const { memberId } = req.params;
    try {
         // Validate memberId
         const member = await pool.query('SELECT * FROM members WHERE id = $1', [memberId]);
         if (member.rows.length === 0) {
             return res.status(404).json({ message: "Member not found" });
         }
        const { start, end } = req.query;
        let query = 'SELECT * FROM attendance WHERE member_id = $1';
        const params = [memberId];
        
        if (start) {
            // Start date: include from 00:00:00 (beginning of the day)
            params.push(start);
            query += ` AND check_in_time >= datetime($${params.length}, '00:00:00')`;
        }
        if (end) {
            // End date: include until 23:59:59 (end of the day)
            params.push(end);
            query += ` AND check_in_time <= datetime($${params.length}, '23:59:59')`;
        }
        query += ' ORDER BY check_in_time DESC';

        const attendanceRecords = await pool.query(query, params);
        res.json(attendanceRecords.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get attendance records for all members with pagination
exports.getAllAttendance = async (req, res) => {
    try {
        const { start, end, member_type, page = 1, limit = 50, search = '' } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;

        let query = `
            SELECT a.id, a.member_id, a.check_in_time, m.name AS member_name, m.is_admin
            FROM attendance a
            JOIN members m ON m.id = a.member_id
            WHERE 1=1`;
        const params = [];
        
        if (start) {
            // Start date: include from 00:00:00 (beginning of the day)
            params.push(start);
            query += ` AND a.check_in_time >= datetime($${params.length}, '00:00:00')`;
        }
        if (end) {
            // End date: include until 23:59:59 (end of the day)
            params.push(end);
            query += ` AND a.check_in_time <= datetime($${params.length}, '23:59:59')`;
        }
        if (member_type === 'admins') {
            query += ` AND m.is_admin = 1`;
        } else if (member_type === 'members') {
            query += ` AND (m.is_admin IS NULL OR m.is_admin = 0)`;
        }

        // Add search condition
        if (search.trim()) {
            query += ` AND m.name ILIKE $${params.length + 1}`;
            params.push(`%${search.trim()}%`);
        }

        // Get total count
        const countQuery = query.replace('SELECT a.id, a.member_id, a.check_in_time, m.name AS member_name, m.is_admin', 'SELECT COUNT(*) as total');
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0]?.total || 0, 10);

        // Add ordering and pagination
        query += ` ORDER BY a.check_in_time DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limitNum, offset);

        const result = await pool.query(query, params);
        const records = result.rows || [];

        res.json({
            attendance: records,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (err) {
        console.error('Error fetching all attendance:', err);
        res.status(500).json({ message: err.message });
    }
};
