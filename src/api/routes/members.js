const express = require('express');
const router = express.Router();
const memberController = require('../controllers/memberController');

// File upload endpoints first to avoid any edge-case matching issues
router.post('/:id/photo', memberController.uploadMemberPhoto);
router.post('/photo/:id', memberController.uploadMemberPhoto); // alias

router.get('/', memberController.getAllMembers);
router.get('/:id', memberController.getMemberById);
router.post('/', memberController.createMember);
router.put('/:id', memberController.updateMember);
router.put('/:id/biometric', memberController.upsertBiometric);
router.put('/:id/status', memberController.setActiveStatus);
router.delete('/:id', memberController.deleteMember);

module.exports = router;
