import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validate } from '../../middleware/validate.js';
import { loginSchema, mobileLoginSchema, refreshTokenSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.schema.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { authRateLimiter } from '../../middleware/rateLimiter.js';
import { Role } from '@prisma/client';

// 1. Admin / Manager Web Auth Router
export const adminAuthRouter = Router();
adminAuthRouter.post('/login', authRateLimiter, validate(loginSchema), AuthController.adminLogin);
adminAuthRouter.post('/refresh', validate(refreshTokenSchema), AuthController.adminRefresh);
adminAuthRouter.post('/logout', authenticate, AuthController.adminLogout);
adminAuthRouter.get('/me', authenticate, authorize([Role.ADMIN, Role.MANAGER]), AuthController.adminGetMe);

// 2. Executive Mobile Auth Router
export const mobileAuthRouter = Router();
mobileAuthRouter.post('/login', authRateLimiter, validate(mobileLoginSchema), AuthController.mobileLogin);
mobileAuthRouter.post('/refresh', validate(refreshTokenSchema), AuthController.mobileRefresh);
mobileAuthRouter.post('/logout', authenticate, AuthController.mobileLogout);
mobileAuthRouter.get('/me', authenticate, authorize([Role.EXECUTIVE, Role.MANAGER]), AuthController.mobileGetMe);

// 3. Central / Legacy Auth Router
const router = Router();
router.post('/login', authRateLimiter, validate(loginSchema), AuthController.login);
router.post('/refresh', validate(refreshTokenSchema), AuthController.refresh);
router.post('/logout', authenticate, AuthController.logout);
router.get('/me', authenticate, AuthController.getMe);
router.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), AuthController.forgotPassword);
router.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), AuthController.resetPassword);

export default router;
