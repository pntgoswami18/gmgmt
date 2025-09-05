const { pool } = require('../../config/sqlite');

// Get member growth statistics
exports.getMemberGrowth = async (req, res) => {
    try {
        const memberGrowth = await pool.query(`
            SELECT 
                substr(join_date, 1, 7) as month,
                COUNT(*) as new_members
            FROM members
            GROUP BY substr(join_date, 1, 7)
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
                date(check_in_time) as date,
                COUNT(*) as total_checkins
            FROM attendance a
            JOIN members m ON a.member_id = m.id
            WHERE m.is_admin = 0
            GROUP BY date(check_in_time)
            ORDER BY date(check_in_time) ASC
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
                substr(payment_date, 1, 7) as month,
                SUM(amount) as total_revenue
            FROM payments
            GROUP BY substr(payment_date, 1, 7)
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
        // Active members: members explicitly marked active
        const activeMembers = await pool.query(`
            SELECT COUNT(*) AS count FROM members WHERE is_active = 1
        `);

        // Total revenue this month
        const totalRevenueThisMonth = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM payments
            WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m','now','localtime')
        `);

        // New members this month
        const newMembersThisMonth = await pool.query(`
            SELECT COUNT(*) as count 
            FROM members 
            WHERE date(join_date) >= date('now','localtime','start of month')
              AND date(join_date) < date('now','localtime','start of month','+1 month')
        `);

        // Members who have NOT made a payment in the current month (excluding admin users)
        const unpaidMembersThisMonth = await pool.query(`
            SELECT COUNT(*) as count
            FROM members m
            WHERE m.is_admin = 0
              AND NOT EXISTS (
                SELECT 1
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                WHERE i.member_id = m.id
                  AND date(p.payment_date) >= date('now','localtime','start of month')
                  AND date(p.payment_date) < date('now','localtime','start of month','+1 month')
            )
        `);
        
        // Active schedules (upcoming from now)
        const activeSchedules = await pool.query(`
            SELECT COUNT(*) as count 
            FROM class_schedules 
            WHERE datetime(start_time) > datetime('now','localtime')
        `);

        const summary = {
            totalMembers: activeMembers.rows[0].count, // active members
            totalRevenueThisMonth: totalRevenueThisMonth.rows[0].total || 0,
            newMembersThisMonth: newMembersThisMonth.rows[0].count,
            activeSchedules: activeSchedules.rows[0].count,
            unpaidMembersThisMonth: unpaidMembersThisMonth.rows[0].count
        };

        res.json(summary);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get financial summary
exports.getFinancialSummary = async (req, res) => {
    try {
        const { startDate, endDate, page = 1, limit = 10, table = 'all' } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;

        // Build date filter condition for payment history
        const dateFilter = startDate && endDate ? `AND p.payment_date >= '${startDate}' AND p.payment_date <= '${endDate}'` : '';

        const result = {};

        // Get outstanding invoices with pagination
        if (table === 'all' || table === 'outstanding') {
            const outstandingInvoices = await pool.query(`
                SELECT i.id, m.name as member_name, i.amount, i.due_date
                FROM invoices i
                JOIN members m ON i.member_id = m.id
                WHERE i.status = 'unpaid'
                  AND m.is_admin = 0
                ORDER BY i.due_date ASC
                LIMIT ${limitNum} OFFSET ${offset}
            `);

            const outstandingCount = await pool.query(`
                SELECT COUNT(*) as total
                FROM invoices i
                JOIN members m ON i.member_id = m.id
                WHERE i.status = 'unpaid'
                  AND m.is_admin = 0
            `);

            result.outstandingInvoices = outstandingInvoices.rows;
            result.outstandingInvoicesTotal = outstandingCount.rows[0].total;
            result.outstandingInvoicesPage = pageNum;
            result.outstandingInvoicesLimit = limitNum;
        }

        // Get payment history with pagination
        if (table === 'all' || table === 'payments') {
            const paymentHistory = await pool.query(`
                SELECT p.id, m.name as member_name, p.amount, p.payment_date
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                JOIN members m ON i.member_id = m.id
                WHERE 1=1 ${dateFilter}
                ORDER BY p.payment_date DESC
                LIMIT ${limitNum} OFFSET ${offset}
            `);

            const paymentCount = await pool.query(`
                SELECT COUNT(*) as total
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                JOIN members m ON i.member_id = m.id
                WHERE 1=1 ${dateFilter}
            `);

            result.paymentHistory = paymentHistory.rows;
            result.paymentHistoryTotal = paymentCount.rows[0].total;
            result.paymentHistoryPage = pageNum;
            result.paymentHistoryLimit = limitNum;
        }

        // Get member payment status with pagination
        if (table === 'all' || table === 'members') {
            const memberPaymentStatus = await pool.query(`
                SELECT
                    m.id,
                    m.name,
                    m.email,
                    m.join_date,
                    mp.name as plan_name,
                    mp.duration_days,
                    (
                        SELECT MAX(p.payment_date)
                        FROM payments p
                        JOIN invoices i ON p.invoice_id = i.id
                        WHERE i.member_id = m.id ${dateFilter.replace('p.payment_date', 'p.payment_date')}
                    ) as last_payment_date,
                    (
                        SELECT i.status
                        FROM invoices i
                        WHERE i.member_id = m.id
                        ORDER BY i.due_date DESC
                        LIMIT 1
                    ) as last_invoice_status,
                    CASE
                        WHEN mp.duration_days IS NULL THEN 0
                        WHEN (
                            SELECT MAX(p.payment_date)
                            FROM payments p
                            JOIN invoices i ON p.invoice_id = i.id
                            WHERE i.member_id = m.id ${dateFilter.replace('p.payment_date', 'p.payment_date')}
                        ) IS NULL THEN
                            CASE
                                WHEN julianday('now') - julianday(m.join_date) > mp.duration_days THEN 1
                                ELSE 0
                            END
                        ELSE
                            CASE
                                WHEN julianday('now') - julianday((
                                    SELECT MAX(p.payment_date)
                                    FROM payments p
                                    JOIN invoices i ON p.invoice_id = i.id
                                    WHERE i.member_id = m.id ${dateFilter.replace('p.payment_date', 'p.payment_date')}
                                )) > mp.duration_days THEN 1
                                ELSE 0
                            END
                    END as is_overdue_for_plan
                FROM members m
                LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
                WHERE m.is_admin = 0
                ORDER BY m.name ASC
                LIMIT ${limitNum} OFFSET ${offset}
            `);

            const memberCount = await pool.query(`
                SELECT COUNT(*) as total
                FROM members m
                WHERE m.is_admin = 0
            `);

            result.memberPaymentStatus = memberPaymentStatus.rows;
            result.memberPaymentStatusTotal = memberCount.rows[0].total;
            result.memberPaymentStatusPage = pageNum;
            result.memberPaymentStatusLimit = limitNum;
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get members who have no payments in the current month
exports.getUnpaidMembersThisMonth = async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.id, m.name, m.email
            FROM members m
            WHERE m.is_admin = 0
              AND NOT EXISTS (
                SELECT 1
                FROM payments p
                JOIN invoices i ON p.invoice_id = i.id
                WHERE i.member_id = m.id
                  AND date(p.payment_date) >= date('now','start of month')
                  AND date(p.payment_date) < date('now','start of month','+1 month')
            )
            ORDER BY m.name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get members whose birthday is today (month and day match, year ignored)
exports.getBirthdaysToday = async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, phone, birthday
            FROM members
            WHERE birthday IS NOT NULL
              AND substr(birthday, 6, 5) = substr(date('now','localtime'), 6, 5)
            ORDER BY name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get payment reminders - invoices that are overdue based on payment_reminder_days setting
exports.getPaymentReminders = async (_req, res) => {
    try {
        // Get payment reminder days setting
        const settingResult = await pool.query(`
            SELECT value FROM settings WHERE key = 'payment_reminder_days'
        `);
        const reminderDays = parseInt(settingResult.rows[0]?.value || '7', 10);
        
        // Get overdue invoices - due date + reminder days <= today
        const result = await pool.query(`
            SELECT 
                i.id as invoice_id,
                i.amount,
                i.due_date,
                i.created_at,
                m.id as member_id,
                m.name as member_name,
                m.phone,
                m.email,
                mp.name as plan_name,
                mp.duration_days,
                julianday('now') - julianday(i.due_date) as days_overdue
            FROM invoices i
            JOIN members m ON i.member_id = m.id
            LEFT JOIN membership_plans mp ON i.plan_id = mp.id
            WHERE i.status = 'unpaid'
              AND julianday('now') >= julianday(i.due_date, '+' || $1 || ' days')
            ORDER BY i.due_date ASC
        `, [reminderDays]);
        
        res.json({
            reminder_days: reminderDays,
            overdue_invoices: result.rows
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get upcoming payment renewals based on membership plan duration
exports.getUpcomingRenewals = async (_req, res) => {
    try {
        // Get payment reminder days setting for notification threshold
        const settingResult = await pool.query(`
            SELECT value FROM settings WHERE key = 'payment_reminder_days'
        `);
        const reminderDays = parseInt(settingResult.rows[0]?.value || '7', 10);
        
        // Find members whose membership expires within reminder days
        const result = await pool.query(`
            SELECT 
                m.id as member_id,
                m.name as member_name,
                m.phone,
                m.email,
                m.join_date,
                mp.name as plan_name,
                mp.duration_days,
                mp.price,
                MAX(p.payment_date) as last_payment_date,
                CASE 
                    WHEN MAX(p.payment_date) IS NOT NULL 
                    THEN date(MAX(p.payment_date), '+' || mp.duration_days || ' days')
                    ELSE date(m.join_date, '+' || mp.duration_days || ' days')
                END as next_due_date
            FROM members m
            LEFT JOIN invoices i ON m.id = i.member_id
            LEFT JOIN payments p ON i.id = p.invoice_id
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            WHERE mp.id IS NOT NULL
              AND m.is_admin = 0
            GROUP BY m.id, m.name, m.phone, m.email, m.join_date, mp.name, mp.duration_days, mp.price
            HAVING julianday(next_due_date) - julianday('now') <= $1 
               AND julianday(next_due_date) - julianday('now') >= 0
            ORDER BY next_due_date ASC
        `, [reminderDays]);
        
        res.json({
            reminder_days: reminderDays,
            upcoming_renewals: result.rows
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};