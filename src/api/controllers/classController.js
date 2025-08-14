const { pool } = require('../../config/sqlite');

// Get all classes
exports.getAllClasses = async (req, res) => {
    try {
        const allClasses = await pool.query('SELECT * FROM classes ORDER BY id ASC');
        res.json(allClasses.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get a single class by ID
exports.getClassById = async (req, res) => {
    const { id } = req.params;
    try {
        const singleClass = await pool.query('SELECT * FROM classes WHERE id = $1', [id]);
        if (singleClass.rows.length === 0) {
            return res.status(404).json({ message: 'Class not found' });
        }
        res.json(singleClass.rows[0]);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Create a new class
exports.createClass = async (req, res) => {
    const { name, description, instructor, duration_minutes } = req.body;
    try {
        await pool.query('INSERT INTO classes (name, description, instructor, duration_minutes) VALUES ($1, $2, $3, $4)', [name, description, instructor, duration_minutes]);
        const created = await pool.query('SELECT * FROM classes ORDER BY id DESC LIMIT 1');
        res.status(201).json(created.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Update a class
exports.updateClass = async (req, res) => {
    const { id } = req.params;
    const { name, description, instructor, duration_minutes } = req.body;
    try {
        await pool.query('UPDATE classes SET name = $1, description = $2, instructor = $3, duration_minutes = $4 WHERE id = $5', [name, description, instructor, duration_minutes, id]);
        const updatedClass = await pool.query('SELECT * FROM classes WHERE id = $1', [id]);
        if (updatedClass.rows.length === 0) {
            return res.status(404).json({ message: 'Class not found' });
        }
        res.json(updatedClass.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Delete a class
exports.deleteClass = async (req, res) => {
    const { id } = req.params;
    try {
        const existing = await pool.query('SELECT id FROM classes WHERE id = $1', [id]);
        if (existing.rowCount === 0) {
            return res.status(404).json({ message: 'Class not found' });
        }
        await pool.query('DELETE FROM classes WHERE id = $1', [id]);
        res.json({ message: 'Class deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
