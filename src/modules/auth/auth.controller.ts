import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class AuthController {
  /**
   * Admin / Manager Web Login
   */
  static async adminLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const ip = (req.ip || req.socket.remoteAddress) as string;
      const ua = req.headers['user-agent'] as string;

      const result = await AuthService.loginAdmin(email, password, ip, ua);
      return sendSuccess(res, result, 'Login successful');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin / Manager Refresh Token
   */
  static async adminRefresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const result = await AuthService.refreshTokens(refreshToken, 'ADMIN');
      return sendSuccess(res, result, 'Tokens refreshed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin / Manager Logout
   */
  static async adminLogout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const ip = (req.ip || req.socket.remoteAddress) as string;
      const ua = req.headers['user-agent'] as string;

      await AuthService.logout(refreshToken, req.user?.userId, ip, ua);
      return sendSuccess(res, null, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin / Manager Current Profile
   */
  static async adminGetMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const user = await AuthService.getCurrentUser(userId);
      return sendSuccess(res, user, 'Profile retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Executive Mobile Login
   */
  static async mobileLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { identifier, email, phone, password } = req.body;
      const targetIdentifier = identifier || email || phone;
      if (!targetIdentifier) {
        return res.status(400).json({ success: false, message: 'Email or phone number is required' });
      }

      const ip = (req.ip || req.socket.remoteAddress) as string;
      const ua = req.headers['user-agent'] as string;

      const result = await AuthService.loginMobile(targetIdentifier, password, ip, ua);
      return sendSuccess(res, result, 'Login successful');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Executive Mobile Refresh
   */
  static async mobileRefresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const result = await AuthService.refreshTokens(refreshToken, 'MOBILE');
      return sendSuccess(res, result, 'Tokens refreshed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Executive Mobile Logout
   */
  static async mobileLogout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { refreshToken, fcmToken } = req.body;
      const ip = (req.ip || req.socket.remoteAddress) as string;
      const ua = req.headers['user-agent'] as string;

      await AuthService.logout(refreshToken, req.user?.userId, ip, ua, fcmToken);
      return sendSuccess(res, null, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Executive Mobile Current Profile
   */
  static async mobileGetMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const user = await AuthService.getCurrentUser(userId);
      return sendSuccess(res, user, 'Profile retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Password Reset Request
   */
  static async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;
      const result = await AuthService.forgotPassword(email);
      return sendSuccess(res, result, 'Password reset request processed');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Complete Password Reset
   */
  static async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { token, code, newPassword } = req.body;
      const targetToken = token || code;
      const result = await AuthService.resetPassword(targetToken, newPassword);
      return sendSuccess(res, result, 'Password reset successful');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Legacy / Common Handlers (Backward compatibility)
   */
  static async login(req: Request, res: Response, next: NextFunction) {
    return AuthController.adminLogin(req, res, next);
  }

  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const result = await AuthService.refreshTokens(refreshToken);
      return sendSuccess(res, result, 'Tokens refreshed successfully');
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    return AuthController.adminLogout(req, res, next);
  }

  static async getMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    return AuthController.adminGetMe(req, res, next);
  }
}
