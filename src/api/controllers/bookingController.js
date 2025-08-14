const { pool } = require('../../config/sqlite');
const { sendEmail } = require('../../services/emailService');

// Book a class for a member
exports.bookClass = async (req, res) => {
    const { member_id, schedule_id } = req.body;

    try {
        // Check if the class is full
        const schedule = await pool.query('SELECT max_capacity FROM class_schedules WHERE id = $1', [schedule_id]);
        if (schedule.rows.length === 0) {
            return res.status(404).json({ message: 'Schedule not found' });
        }

        const bookingCount = await pool.query('SELECT COUNT(*) as cnt FROM bookings WHERE schedule_id = $1', [schedule_id]);
        if ((Number(bookingCount.rows[0].cnt) || 0) >= schedule.rows[0].max_capacity) {
            return res.status(400).json({ message: 'This class is already full.' });
        }

        // Create the booking
        await pool.query('INSERT INTO bookings (member_id, schedule_id) VALUES ($1, $2)', [member_id, schedule_id]);
        const newBooking = await pool.query('SELECT * FROM bookings WHERE member_id = $1 AND schedule_id = $2 ORDER BY id DESC LIMIT 1', [member_id, schedule_id]);

        // Get member and class details for email
        const memberDetails = await pool.query('SELECT name, email FROM members WHERE id = $1', [member_id]);
        const classDetails = await pool.query(`
            SELECT c.name, s.start_time 
            FROM class_schedules s 
            JOIN classes c ON s.class_id = c.id 
            WHERE s.id = $1
        `, [schedule_id]);

        if (memberDetails.rows.length > 0 && classDetails.rows.length > 0) {
            const member = memberDetails.rows[0];
            const classInfo = classDetails.rows[0];
            
            // Send booking confirmation email
            await sendEmail('bookingConfirmation', [
                member.name, 
                member.email, 
                classInfo.name, 
                classInfo.start_time
            ]);
        }

        res.status(201).json(newBooking.rows[0]);
    } catch (err) {
        // Handle unique constraint violation (member already booked)
        // SQLite uses constraint names; we return conflict on any UNIQUE violation
        if (String(err.message || '').toLowerCase().includes('unique')) { 
            return res.status(409).json({ message: 'You have already booked this class.' });
        }
        res.status(500).json({ message: err.message });
    }
};

// Get all bookings for a member
exports.getMemberBookings = async (req, res) => {
    const { memberId } = req.params;
    try {
        const bookings = await pool.query(
            `SELECT b.id, c.name as class_name, s.start_time, s.end_time, b.status
             FROM bookings b
             JOIN class_schedules s ON b.schedule_id = s.id
             JOIN classes c ON s.class_id = c.id
             WHERE b.member_id = $1
             ORDER BY s.start_time ASC`,
            [memberId]
        );
        res.json(bookings.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Cancel a booking
exports.cancelBooking = async (req, res) => {
    const { bookingId } = req.params;
    try {
        // Instead of deleting, we can update the status to 'cancelled'
        const cancelledBooking = await pool.query(
            `UPDATE bookings SET status = 'cancelled' WHERE id = $1 RETURNING *`,
            [bookingId]
        );

        if (cancelledBooking.rows.length === 0) {
            return res.status(404).json({ message: 'Booking not found.' });
        }
        
        res.json({ message: 'Booking cancelled successfully', booking: cancelledBooking.rows[0] });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
