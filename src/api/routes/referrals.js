const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');

// Test endpoint
router.get('/test', (req, res) => {
    res.json({ message: 'Referrals API is working' });
});

// Get all referrals
router.get('/', referralController.getReferrals);

// Create a new referral
router.post('/', referralController.createReferral);

// Apply referral discount
router.post('/:referral_id/apply', referralController.applyReferralDiscount);

module.exports = router;
