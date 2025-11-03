import express from 'express';
import { signup, verifyOtp, login, forgotPassword, resetPassword, inviteAdmin, completeAdminSignup, listAdmins, removeAdmin } from '../controllers/authController.js';
import { authenticate, authorizeRole } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/registration', signup); // Done 
router.post('/verify-otp', verifyOtp); // Done
router.post('/login', login); // Done
router.post('/forgot-password', forgotPassword); // Done
router.post('/reset-password', resetPassword); // Done
router.post(
  '/invite',
  authenticate,
  authorizeRole(['super_admin']),
  inviteAdmin
); // Done
router.post('/complete-admin-signup', completeAdminSignup); // Done
router.get('/admin-list', authenticate, authorizeRole(['super_admin']), listAdmins);
router.delete('/remove-admin/:id', authenticate, authorizeRole(['super_admin']), removeAdmin);
export default router;