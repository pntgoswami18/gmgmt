const { pool } = require('../../config/database');

// This endpoint would be called by the biometric device
exports.checkIn = async (req, res) => {
    const { memberId } = req.body; // The device would send the member's unique ID
    if (!memberId) {
        return res.status(400).json({ message: "Member ID is required." });
    }

    try {
        // 1. Validate memberId
        const member = await pool.query('SELECT * FROM members WHERE id = $1', [memberId]);
        if (member.rows.length === 0) {
            return res.status(404).json({ message: "Member not found" });
        }

        // 2. Enforce session windows (morning: 05:00-11:00, evening: 16:00-22:00)
        const now = new Date();
        const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();

        const MORNING_START_MINUTES = 5 * 60;   // 05:00
        const MORNING_END_MINUTES = 11 * 60;    // 11:00
        const EVENING_START_MINUTES = 16 * 60;  // 16:00
        const EVENING_END_MINUTES = 22 * 60;    // 22:00

        const isInMorningSession = minutesSinceMidnight >= MORNING_START_MINUTES && minutesSinceMidnight <= MORNING_END_MINUTES;
        const isInEveningSession = minutesSinceMidnight >= EVENING_START_MINUTES && minutesSinceMidnight <= EVENING_END_MINUTES;

        if (!isInMorningSession && !isInEveningSession) {
            return res.status(400).json({ message: 'Check-in allowed only during Morning (05:00-11:00) or Evening (16:00-22:00) sessions.' });
        }

        // 3. Allow only one check-in per calendar date (either morning or evening)
        const alreadyCheckedInToday = await pool.query(
            `SELECT 1 FROM attendance 
             WHERE member_id = $1 AND check_in_time::date = CURRENT_DATE 
             LIMIT 1`,
            [memberId]
        );

        if (alreadyCheckedInToday.rowCount > 0) {
            return res.status(409).json({ message: 'Member has already checked in today.' });
        }

        // 4. Create a new attendance record with the current timestamp
        const newAttendance = await pool.query(
            'INSERT INTO attendance (member_id, check_in_time) VALUES ($1, NOW()) RETURNING *',
            [memberId]
        );

        console.log(`Member ${memberId} checked in at ${newAttendance.rows[0].check_in_time}`);

        res.status(200).json({ 
            message: `Member ${memberId} checked in successfully.`,
            attendance: newAttendance.rows[0]
        });
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

        const attendanceRecords = await pool.query(
            'SELECT * FROM attendance WHERE member_id = $1 ORDER BY check_in_time DESC',
            [memberId]
        );
        res.json(attendanceRecords.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
