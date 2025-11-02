import express from 'express';
import { signup, verifyOtp, login, forgotPassword, resetPassword, inviteAdmin, completeAdminSignup, listAdmins, removeAdmin } from '../controllers/authController.js';
import { authenticate, authorizeRole } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/registration', signup);
router.post('/verify-otp', verifyOtp);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post(
  '/invite',
  authenticate,
  authorizeRole(['super_admin']),
  inviteAdmin
);
router.post('/complete', completeAdminSignup);
router.get('/admin-list', authenticate, authorizeRole(['super_admin']), listAdmins);
router.delete('/:id', authenticate, authorizeRole(['super_admin']), removeAdmin);
export default router;