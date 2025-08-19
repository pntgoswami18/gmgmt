const { pool } = require('../../config/sqlite');

// This endpoint would be called by the biometric device
const performCheckIn = async (resolvedMemberId, res) => {
    if (resolvedMemberId === undefined || resolvedMemberId === null) {
        return res.status(400).json({ message: 'A valid memberId is required to check in.' });
    }
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
         WHERE member_id = $1 AND DATE(check_in_time) = DATE('now') 
         LIMIT 1`,
        [resolvedMemberId]
    );

    if (alreadyCheckedInToday.rowCount > 0) {
        return res.status(409).json({ message: 'Member has already checked in today.' });
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
            query += ` AND DATE(check_in_time) >= DATE($${params.length})`;
        }
        if (end) {
            params.push(end);
            query += ` AND DATE(check_in_time) <= DATE($${params.length})`;
        }
        query += ' ORDER BY check_in_time DESC';

        const attendanceRecords = await pool.query(query, params);
        res.json(attendanceRecords.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get attendance records for all members (optionally filtered by date range)
exports.getAllAttendance = async (req, res) => {
    try {
        const { start, end } = req.query;
        let query = `
            SELECT a.id, a.member_id, a.check_in_time, m.name AS member_name
            FROM attendance a
            JOIN members m ON m.id = a.member_id
            WHERE 1=1`;
        const params = [];
        if (start) {
            params.push(start);
            query += ` AND DATE(a.check_in_time) >= DATE($${params.length})`;
        }
        if (end) {
            params.push(end);
            query += ` AND DATE(a.check_in_time) <= DATE($${params.length})`;
        }
        query += ' ORDER BY a.check_in_time DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
