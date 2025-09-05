const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');

// Create a new referral
router.post('/', referralController.createReferral);

// Get all referrals
router.get('/', referralController.getReferrals);

// Apply referral discount
router.post('/:referral_id/apply', referralController.applyReferralDiscount);

module.exports = router;
