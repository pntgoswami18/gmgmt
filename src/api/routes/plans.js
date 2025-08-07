const express = require('express');
const router = express.Router();
const planController = require('../controllers/planController');

router.post('/', planController.createPlan);
router.get('/', planController.getAllPlans);

module.exports = router;
