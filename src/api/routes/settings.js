const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const upload = require('../../config/multer');

// Add a simple test route
router.get('/test', (req, res) => {
    console.log('Test route hit');
    res.json({ message: 'Settings route is working' });
});

router.get('/', settingsController.getAllSettings);
router.put('/', settingsController.updateAllSettings);
router.post('/upload-logo', upload, settingsController.uploadLogo);

module.exports = router;
