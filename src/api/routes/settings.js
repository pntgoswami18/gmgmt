const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const upload = require('../../config/multer');

router.put('/:key', settingsController.updateSetting);
router.get('/:key', settingsController.getSetting);
router.post('/upload-logo', upload, settingsController.uploadLogo);

module.exports = router;
