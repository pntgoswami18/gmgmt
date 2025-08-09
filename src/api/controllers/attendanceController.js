const { pool } = require('../../config/database');

// This endpoint would be called by the biometric device
const performCheckIn = async (resolvedMemberId, res) => {
    // Validate member exists
    const member = await pool.query('SELECT id FROM members WHERE id = $1', [resolvedMemberId]);
    if (member.rows.length === 0) {
        return res.status(404).json({ message: 'Member not found' });
    }

    // Enforce configured session windows
    const settingsRes = await pool.query(`
        SELECT key, value FROM settings WHERE key IN (
            'morning_session_start','morning_session_end','evening_session_start','evening_session_end'
        )
    `);
    const settingsMap = Object.fromEntries(settingsRes.rows.map(r => [r.key, r.value]));
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

    // Only one check-in per day
    const alreadyCheckedInToday = await pool.query(
        `SELECT 1 FROM attendance 
         WHERE member_id = $1 AND check_in_time::date = CURRENT_DATE 
         LIMIT 1`,
        [resolvedMemberId]
    );

    if (alreadyCheckedInToday.rowCount > 0) {
        return res.status(409).json({ message: 'Member has already checked in today.' });
    }

    const newAttendance = await pool.query(
        'INSERT INTO attendance (member_id, check_in_time) VALUES ($1, NOW()) RETURNING *',
        [resolvedMemberId]
    );

    return res.status(200).json({ 
        message: `Member ${resolvedMemberId} checked in successfully.`,
        attendance: newAttendance.rows[0]
    });
};

exports.checkIn = async (req, res) => {
    const { memberId, device_user_id } = req.body; // from app or device gateway
    if (!memberId && !device_user_id) {
        return res.status(400).json({ message: 'Member ID or device_user_id is required.' });
    }

    try {
        let resolvedMemberId = memberId;
        if (!resolvedMemberId && device_user_id) {
            const map = await pool.query('SELECT member_id FROM member_biometrics WHERE device_user_id = $1', [device_user_id]);
            if (map.rowCount > 0) {
                resolvedMemberId = map.rows[0].member_id;
            }
        }
        await performCheckIn(resolvedMemberId, res);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Device webhook compatible with Secureye push formats
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
            params.push(start);
            query += ` AND check_in_time::date >= $${params.length}`;
        }
        if (end) {
            params.push(end);
            query += ` AND check_in_time::date <= $${params.length}`;
        }
        query += ' ORDER BY check_in_time DESC';

        const attendanceRecords = await pool.query(query, params);
        res.json(attendanceRecords.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
