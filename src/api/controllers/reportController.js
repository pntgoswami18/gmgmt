const pool = require('../../config/database');

// Get member growth statistics
exports.getMemberGrowth = async (req, res) => {
    try {
        const memberGrowth = await pool.query(`
            SELECT 
                DATE_TRUNC('month', join_date) as month,
                COUNT(*) as new_members
            FROM members
            WHERE join_date >= CURRENT_DATE - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', join_date)
            ORDER BY month ASC
        `);
        res.json(memberGrowth.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get attendance statistics
exports.getAttendanceStats = async (req, res) => {
    try {
        const attendanceStats = await pool.query(`
            SELECT 
                DATE_TRUNC('day', check_in_time) as date,
                COUNT(*) as total_checkins
            FROM attendance
            WHERE check_in_time >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY DATE_TRUNC('day', check_in_time)
            ORDER BY date ASC
        `);
        res.json(attendanceStats.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get popular classes
exports.getPopularClasses = async (req, res) => {
    try {
        const popularClasses = await pool.query(`
            SELECT 
                c.name,
                c.instructor,
                COUNT(b.id) as booking_count
            FROM classes c
            LEFT JOIN class_schedules cs ON c.id = cs.class_id
            LEFT JOIN bookings b ON cs.id = b.schedule_id
            WHERE b.status = 'confirmed'
            GROUP BY c.id, c.name, c.instructor
            ORDER BY booking_count DESC
            LIMIT 10
        `);
        res.json(popularClasses.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get revenue statistics
exports.getRevenueStats = async (req, res) => {
    try {
        const revenueStats = await pool.query(`
            SELECT 
                DATE_TRUNC('month', payment_date) as month,
                SUM(amount) as total_revenue
            FROM payments
            WHERE payment_date >= CURRENT_DATE - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', payment_date)
            ORDER BY month ASC
        `);
        res.json(revenueStats.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get overall summary stats
exports.getSummaryStats = async (req, res) => {
    try {
        // Total members
        const totalMembers = await pool.query('SELECT COUNT(*) as count FROM members');
        
        // Total revenue
        const totalRevenue = await pool.query('SELECT SUM(amount) as total FROM payments');
        
        // Members this month
        const membersThisMonth = await pool.query(`
            SELECT COUNT(*) as count 
            FROM members 
            WHERE join_date >= DATE_TRUNC('month', CURRENT_DATE)
        `);
        
        // Active schedules
        const activeSchedules = await pool.query(`
            SELECT COUNT(*) as count 
            FROM class_schedules 
            WHERE start_time > CURRENT_TIMESTAMP
        `);

        const summary = {
            totalMembers: totalMembers.rows[0].count,
            totalRevenue: totalRevenue.rows[0].total || 0,
            newMembersThisMonth: membersThisMonth.rows[0].count,
            activeSchedules: activeSchedules.rows[0].count
        };

        res.json(summary);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};