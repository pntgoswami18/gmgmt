const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const upload = require('../../config/multer');

router.get('/:key', settingsController.getSetting);
router.put('/:key', settingsController.updateSetting);
router.post('/upload-logo', upload, settingsController.uploadLogo);

module.exports = router;

