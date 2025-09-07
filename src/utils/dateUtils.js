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

module.exports = {
    calculateNormalizedDueDate,
    calculateDueDateForPlan
};
