const express = require('express');
const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
    res.json({ message: 'Referrals API is working' });
});

// Simple referrals endpoint
router.get('/', (req, res) => {
    res.json({ referrals: [] });
});

module.exports = router;
