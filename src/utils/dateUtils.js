/**
 * Calculate normalized due date based on joining date and membership plan duration
 * For monthly plans, this ensures the due date is always the same day of the month
 * regardless of the number of days in the current month
 * 
 * @param {string} joinDate - Join date in YYYY-MM-DD format
 * @param {number} durationDays - Duration in days from membership plan
 * @returns {string} Due date in YYYY-MM-DD format
 */
function calculateNormalizedDueDate(joinDate, durationDays) {
    if (!joinDate || !durationDays) {
        throw new Error('Join date and duration days are required');
    }

    const join = new Date(joinDate);
    if (isNaN(join.getTime())) {
        throw new Error('Invalid join date format. Use YYYY-MM-DD');
    }

    const dueDate = new Date(join);
    
    // For monthly plans (30 days), use normalized month calculation
    if (durationDays === 30) {
        // Get the day of the month from join date
        const dayOfMonth = join.getDate();
        
        // Create a new date for the next month, same day
        // Handle month overflow correctly
        let nextYear = join.getFullYear();
        let nextMonth = join.getMonth() + 1;
        
        if (nextMonth > 11) {
            nextMonth = 0;
            nextYear++;
        }
        
        // First, try to create the date with the same day
        let nextMonthDate = new Date(nextYear, nextMonth, dayOfMonth);
        
        // If the day doesn't exist in the target month, JavaScript will roll over
        // We need to check if the month changed and adjust accordingly
        if (nextMonthDate.getMonth() !== nextMonth) {
            // The day doesn't exist in the target month, use the last day of the target month
            // Use a more explicit approach to get the last day
            const lastDay = new Date(nextYear, nextMonth + 1, 0);
            nextMonthDate = new Date(nextYear, nextMonth, lastDay.getDate());
        }
        
        // Format the date as YYYY-MM-DD without timezone issues
        const year = nextMonthDate.getFullYear();
        const month = String(nextMonthDate.getMonth() + 1).padStart(2, '0');
        const day = String(nextMonthDate.getDate()).padStart(2, '0');
        
        return `${year}-${month}-${day}`;
    } else {
        // For other durations, use simple day addition
        dueDate.setDate(dueDate.getDate() + durationDays);
    }

    return dueDate.toISOString().split('T')[0];
}

/**
 * Calculate due date for a specific membership plan
 * 
 * @param {string} joinDate - Join date in YYYY-MM-DD format
 * @param {Object} plan - Membership plan object with duration_days property
 * @returns {string} Due date in YYYY-MM-DD format
 */
function calculateDueDateForPlan(joinDate, plan) {
    if (!plan || !plan.duration_days) {
        throw new Error('Valid membership plan with duration_days is required');
    }
    
    return calculateNormalizedDueDate(joinDate, plan.duration_days);
}

/**
 * Check if a member is overdue considering grace period
 * 
 * @param {Object} member - Member object with join_date and membership_plan_id
 * @param {Object} plan - Membership plan object with duration_days
 * @param {string} lastPaymentDate - Last payment date in YYYY-MM-DD format (optional)
 * @param {number} gracePeriodDays - Grace period in days (default: 3)
 * @returns {Object} Object with isOverdue, daysOverdue, and gracePeriodExpired properties
 */
function checkMemberPaymentStatus(member, plan, lastPaymentDate = null, gracePeriodDays = 3) {
    if (!member || !plan || !plan.duration_days) {
        return {
            isOverdue: false,
            daysOverdue: 0,
            gracePeriodExpired: false,
            error: 'Invalid member or plan data'
        };
    }

    try {
        let referenceDate;
        
        if (lastPaymentDate) {
            // Use last payment date as reference
            referenceDate = new Date(lastPaymentDate);
        } else {
            // Use join date as reference
            referenceDate = new Date(member.join_date);
        }
        
        if (isNaN(referenceDate.getTime())) {
            return {
                isOverdue: false,
                daysOverdue: 0,
                gracePeriodExpired: false,
                error: 'Invalid date format'
            };
        }

        // Calculate due date based on reference date and plan duration
        const dueDate = new Date(referenceDate);
        dueDate.setDate(dueDate.getDate() + plan.duration_days);
        
        const today = new Date();
        const daysSinceDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
        
        const isOverdue = daysSinceDue > 0;
        const gracePeriodExpired = daysSinceDue > gracePeriodDays;
        
        return {
            isOverdue,
            daysOverdue: Math.max(0, daysSinceDue),
            gracePeriodExpired,
            dueDate: dueDate.toISOString().split('T')[0],
            referenceDate: referenceDate.toISOString().split('T')[0]
        };
    } catch (error) {
        return {
            isOverdue: false,
            daysOverdue: 0,
            gracePeriodExpired: false,
            error: error.message
        };
    }
}

/**
 * Get grace period setting from database
 * 
 * @param {Object} pool - Database connection pool
 * @returns {Promise<number>} Grace period in days
 */
async function getGracePeriodSetting(pool) {
    try {
        const result = await pool.query('SELECT value FROM settings WHERE key = ?', ['payment_grace_period_days']);
        return parseInt(result.rows[0]?.value || '3', 10);
    } catch (error) {
        console.error('Error getting grace period setting:', error);
        return 3; // Default grace period
    }
}

module.exports = {
    calculateNormalizedDueDate,
    calculateDueDateForPlan,
    checkMemberPaymentStatus,
    getGracePeriodSetting
};
