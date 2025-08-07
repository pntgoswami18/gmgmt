const pool = require('../../config/database');

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

        // 2. Create a new attendance record with the current timestamp
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
