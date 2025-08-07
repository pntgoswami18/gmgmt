const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

router.get('/:key', settingsController.getSetting);
router.put('/:key', settingsController.updateSetting);

module.exports = router;

