const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

router.get('/member-growth', reportController.getMemberGrowth);
router.get('/attendance-stats', reportController.getAttendanceStats);
router.get('/popular-classes', reportController.getPopularClasses);
router.get('/revenue-stats', reportController.getRevenueStats);
router.get('/summary', reportController.getSummaryStats);
router.get('/financial-summary', reportController.getFinancialSummary);
router.get('/unpaid-members-this-month', reportController.getUnpaidMembersThisMonth);
router.get('/birthdays-today', reportController.getBirthdaysToday);

module.exports = router;