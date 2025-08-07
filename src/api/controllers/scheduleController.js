const pool = require('../config/database');

// Get all schedules
exports.getAllSchedules = async (req, res) => {
    try {
        const allSchedules = await pool.query(
            `SELECT cs.id, c.name as class_name, c.instructor, cs.start_time, cs.end_time, cs.max_capacity 
             FROM class_schedules cs
             JOIN classes c ON cs.class_id = c.id
             ORDER BY cs.start_time ASC`
        );
        res.json(allSchedules.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get a single schedule by ID
exports.getScheduleById = async (req, res) => {
    const { id } = req.params;
    try {
        const schedule = await pool.query(
            `SELECT cs.id, c.name as class_name, c.instructor, cs.start_time, cs.end_time, cs.max_capacity 
             FROM class_schedules cs
             JOIN classes c ON cs.class_id = c.id
             WHERE cs.id = $1`, [id]);
        if (schedule.rows.length === 0) {
            return res.status(404).json({ message: 'Schedule not found' });
        }
        res.json(schedule.rows[0]);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Create a new schedule
exports.createSchedule = async (req, res) => {
    const { class_id, start_time, end_time, max_capacity } = req.body;
    try {
        const newSchedule = await pool.query(
            'INSERT INTO class_schedules (class_id, start_time, end_time, max_capacity) VALUES ($1, $2, $3, $4) RETURNING *',
            [class_id, start_time, end_time, max_capacity]
        );
        res.status(201).json(newSchedule.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Update a schedule
exports.updateSchedule = async (req, res) => {
    const { id } = req.params;
    const { class_id, start_time, end_time, max_capacity } = req.body;
    try {
        const updatedSchedule = await pool.query(
            'UPDATE class_schedules SET class_id = $1, start_time = $2, end_time = $3, max_capacity = $4 WHERE id = $5 RETURNING *',
            [class_id, start_time, end_time, max_capacity, id]
        );
        if (updatedSchedule.rows.length === 0) {
            return res.status(404).json({ message: 'Schedule not found' });
        }
        res.json(updatedSchedule.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Delete a schedule
exports.deleteSchedule = async (req, res) => {
    const { id } = req.params;
    try {
        const deletedSchedule = await pool.query('DELETE FROM class_schedules WHERE id = $1 RETURNING *', [id]);
        if (deletedSchedule.rowCount === 0) {
            return res.status(404).json({ message: 'Schedule not found' });
        }
        res.json({ message: 'Schedule deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
