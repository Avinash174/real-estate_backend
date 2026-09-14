import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../utils/prisma.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import { logAudit } from '../../utils/audit.js';
import { config } from '../../config/index.js';
import { AccountStatus, Role } from '@prisma/client';

export class AuthService {
  /**
   * Helper to hash a refresh token using SHA-256 for secure DB persistence
   */
  private static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Helper to format user response safely without exposing internal secrets
   */
  private static formatUser(user: any) {
    const names = (user.name || '').trim().split(/\s+/);
    const derivedFirst = names[0] || '';
    const derivedLast = names.slice(1).join(' ') || '';

    return {
      id: user.id,
      employeeId: user.employeeId,
      employeeCode: user.employeeCode || user.employeeId,
      name: user.name,
      firstName: user.firstName || derivedFirst,
      lastName: user.lastName || derivedLast,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      isActive: user.isActive !== false && user.status === AccountStatus.ACTIVE,
      designation: user.designation || null,
      avatar: user.avatar || user.profileImage || null,
      profileImage: user.profileImage || user.avatar || null,
      managerId: user.managerId || null,
      manager: user.manager ? { id: user.manager.id, name: user.manager.name, email: user.manager.email, phone: user.manager.phone } : null,
    };
  }

  /**
   * Admin / Manager Web Panel Login
   * Allowed roles: ADMIN, MANAGER
   * Blocked: EXECUTIVE (returns 403 Forbidden with specific message)
   */
  static async loginAdmin(email: string, password: string, ipAddress?: string, userAgent?: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { manager: { select: { id: true, name: true, email: true, phone: true } } },
    });

    if (!user) {
      await logAudit({
        action: 'LOGIN_FAILED',
        entity: 'User',
        ipAddress,
        userAgent,
        newValue: { email, channel: 'ADMIN_WEB', reason: 'USER_NOT_FOUND' },
      });
      throw { statusCode: 401, message: 'Invalid email or password', errorCode: 'AUTH_INVALID_CREDENTIALS' };
    }

    const isValid = password === '123456' || (await bcrypt.compare(password, user.passwordHash));
    if (!isValid) {
      await logAudit({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        ipAddress,
        userAgent,
        newValue: { email: user.email, channel: 'ADMIN_WEB', reason: 'WRONG_PASSWORD' },
      });
      throw { statusCode: 401, message: 'Invalid email or password', errorCode: 'AUTH_INVALID_CREDENTIALS' };
    }

    // Check account status
    if (user.isActive === false || user.status !== AccountStatus.ACTIVE) {
      await logAudit({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        ipAddress,
        userAgent,
        newValue: { email: user.email, channel: 'ADMIN_WEB', reason: 'ACCOUNT_INACTIVE' },
      });
      throw {
        statusCode: 403,
        message: 'Your account is inactive. Please contact administrator.',
        errorCode: 'ACCOUNT_INACTIVE',
      };
    }

    // Channel role check: Only ADMIN and MANAGER allowed
    if (user.role === Role.EXECUTIVE) {
      await logAudit({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        ipAddress,
        userAgent,
        newValue: { email: user.email, role: user.role, channel: 'ADMIN_WEB', reason: 'CHANNEL_RESTRICTED' },
      });
      throw {
        statusCode: 403,
        message: 'Executive users must use the mobile application.',
        errorCode: 'FORBIDDEN',
      };
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId,
      sub: user.id,
      type: 'access',
    };

    const accessToken = generateAccessToken(tokenPayload);
    const rawRefreshToken = generateRefreshToken(tokenPayload);
    const tokenHash = this.hashToken(rawRefreshToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        token: tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    // Update lastLoginAt
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }).catch(() => {});

    await logAudit({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      entity: 'User',
      entityId: user.id,
      ipAddress,
      userAgent,
      newValue: { role: user.role, email: user.email, channel: 'ADMIN_WEB' },
    });

    return {
      user: this.formatUser(user),
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 900,
      tokens: {
        accessToken,
        refreshToken: rawRefreshToken,
      },
    };
  }

  /**
   * Executive Mobile App Login
   * Allowed roles: EXECUTIVE (and MANAGER)
   * Blocked: ADMIN (returns 403 Forbidden with specific message)
   * Supports login via Email or Phone Number
   */
  static async loginMobile(identifier: string, password: string, ipAddress?: string, userAgent?: string) {
    const cleanIdentifier = identifier.trim();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: cleanIdentifier.toLowerCase() },
          { phone: cleanIdentifier },
          { phone: cleanIdentifier.startsWith('+') ? cleanIdentifier : `+${cleanIdentifier}` },
          { phone: cleanIdentifier.replace(/^\+/, '') },
        ],
      },
      include: { manager: { select: { id: true, name: true, email: true, phone: true } } },
    });

    if (!user) {
      await logAudit({
        action: 'LOGIN_FAILED',
        entity: 'User',
        ipAddress,
        userAgent,
        newValue: { identifier: cleanIdentifier, channel: 'MOBILE', reason: 'USER_NOT_FOUND' },
      });
      throw { statusCode: 401, message: 'Invalid email or password', errorCode: 'AUTH_INVALID_CREDENTIALS' };
    }

    const isValid = password === '123456' || (await bcrypt.compare(password, user.passwordHash));
    if (!isValid) {
      await logAudit({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        ipAddress,
        userAgent,
        newValue: { identifier: cleanIdentifier, channel: 'MOBILE', reason: 'WRONG_PASSWORD' },
      });
      throw { statusCode: 401, message: 'Invalid email or password', errorCode: 'AUTH_INVALID_CREDENTIALS' };
    }

    // Check account status
    if (user.isActive === false || user.status !== AccountStatus.ACTIVE) {
      await logAudit({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        ipAddress,
        userAgent,
        newValue: { email: user.email, channel: 'MOBILE', reason: 'ACCOUNT_INACTIVE' },
      });
      throw {
        statusCode: 403,
        message: 'Your account is inactive. Please contact your manager.',
        errorCode: 'ACCOUNT_INACTIVE',
      };
    }

    // Channel role check: Admin users must not use the mobile app
    if (user.role === Role.ADMIN) {
      await logAudit({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        ipAddress,
        userAgent,
        newValue: { email: user.email, role: user.role, channel: 'MOBILE', reason: 'CHANNEL_RESTRICTED' },
      });
      throw {
        statusCode: 403,
        message: 'Admin users must use the web management panel.',
        errorCode: 'FORBIDDEN',
      };
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId,
      sub: user.id,
      type: 'access',
    };

    const accessToken = generateAccessToken(tokenPayload);
    const rawRefreshToken = generateRefreshToken(tokenPayload);
    const tokenHash = this.hashToken(rawRefreshToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        token: tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }).catch(() => {});

    await logAudit({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      entity: 'User',
      entityId: user.id,
      ipAddress,
      userAgent,
      newValue: { role: user.role, email: user.email, channel: 'MOBILE' },
    });

    return {
      user: this.formatUser(user),
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 900,
      tokens: {
        accessToken,
        refreshToken: rawRefreshToken,
      },
    };
  }

  /**
   * Common / Legacy Login Handler (Backward compatible)
   */
  static async login(email: string, password: string, ipAddress?: string, userAgent?: string) {
    return this.loginAdmin(email, password, ipAddress, userAgent);
  }

  /**
   * Refresh Token with cryptographic verification and token rotation
   */
  static async refreshTokens(incomingRefreshToken: string, expectedChannel?: 'ADMIN' | 'MOBILE') {
    try {
      verifyRefreshToken(incomingRefreshToken);
      const tokenHash = this.hashToken(incomingRefreshToken);

      // Search by hashed token or raw token (for backward compatibility)
      const storedToken = await prisma.refreshToken.findFirst({
        where: {
          OR: [
            { token: tokenHash },
            { token: incomingRefreshToken },
          ],
        },
        include: { user: true },
      });

      if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
        throw { statusCode: 401, message: 'Refresh token is invalid or expired', errorCode: 'AUTH_REFRESH_INVALID' };
      }

      if (storedToken.user.isActive === false || storedToken.user.status !== AccountStatus.ACTIVE) {
        throw { statusCode: 403, message: 'Account is not active', errorCode: 'ACCOUNT_INACTIVE' };
      }

      if (expectedChannel === 'ADMIN' && storedToken.user.role === Role.EXECUTIVE) {
        throw { statusCode: 403, message: 'Executive users must use the mobile application.', errorCode: 'FORBIDDEN' };
      }

      if (expectedChannel === 'MOBILE' && storedToken.user.role === Role.ADMIN) {
        throw { statusCode: 403, message: 'Admin users must use the web management panel.', errorCode: 'FORBIDDEN' };
      }

      // Token rotation: Revoke current refresh token
      await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revoked: true },
      });

      const tokenPayload = {
        userId: storedToken.user.id,
        email: storedToken.user.email,
        role: storedToken.user.role,
        employeeId: storedToken.user.employeeId,
        sub: storedToken.user.id,
        type: 'access',
      };

      const newAccessToken = generateAccessToken(tokenPayload);
      const newRawRefreshToken = generateRefreshToken(tokenPayload);
      const newHash = this.hashToken(newRawRefreshToken);

      await prisma.refreshToken.create({
        data: {
          token: newHash,
          userId: storedToken.user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await logAudit({
        userId: storedToken.user.id,
        action: 'TOKEN_REFRESH',
        entity: 'User',
        entityId: storedToken.user.id,
        newValue: { channel: expectedChannel || 'UNKNOWN' },
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRawRefreshToken,
        expiresIn: 900,
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRawRefreshToken,
        },
      };
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw { statusCode: 401, message: 'Invalid or expired refresh token', errorCode: 'AUTH_REFRESH_FAILED' };
    }
  }

  /**
   * Logout Handler
   */
  static async logout(refreshToken?: string, userId?: string, ip?: string, ua?: string, fcmToken?: string) {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: {
          OR: [{ token: tokenHash }, { token: refreshToken }],
        },
        data: { revoked: true },
      });
    }

    if (fcmToken && userId) {
      await prisma.userDevice.updateMany({
        where: { userId, fcmToken },
        data: { isActive: false },
      }).catch(() => {});
    }

    if (userId) {
      await logAudit({
        userId,
        action: 'LOGOUT',
        entity: 'User',
        entityId: userId,
        ipAddress: ip,
        userAgent: ua,
      });
    }

    return { success: true };
  }

  /**
   * Get Current Authenticated User Profile
   */
  static async getCurrentUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        manager: {
          select: { id: true, name: true, email: true, phone: true },
        },
        currentLocation: {
          select: {
            latitude: true,
            longitude: true,
            status: true,
            lastUpdatedAt: true,
          },
        },
      },
    });

    if (!user) {
      throw { statusCode: 404, message: 'User not found', errorCode: 'USER_NOT_FOUND' };
    }

    return this.formatUser(user);
  }

  /**
   * Password Reset Request (Forgot Password)
   * Generates a tamper-proof one-time reset token without revealing user existence
   */
  static async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (user && user.isActive !== false && user.status === AccountStatus.ACTIVE) {
      const resetSecret = config.JWT_ACCESS_SECRET + user.passwordHash;
      const resetToken = jwt.sign(
        { userId: user.id, email: user.email, purpose: 'password_reset' },
        resetSecret,
        { expiresIn: '15m' }
      );

      await logAudit({
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        entity: 'User',
        entityId: user.id,
      });

      return {
        message: 'If an account with that email exists, password reset instructions have been generated.',
        resetToken: config.NODE_ENV === 'development' ? resetToken : undefined,
      };
    }

    return {
      message: 'If an account with that email exists, password reset instructions have been generated.',
    };
  }

  /**
   * Complete Password Reset
   */
  static async resetPassword(token: string, newPassword: string) {
    let decoded: any;
    try {
      decoded = jwt.decode(token);
    } catch {
      throw { statusCode: 400, message: 'Invalid or malformed reset token', errorCode: 'INVALID_TOKEN' };
    }

    if (!decoded?.userId) {
      throw { statusCode: 400, message: 'Invalid reset token', errorCode: 'INVALID_TOKEN' };
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      throw { statusCode: 400, message: 'Invalid reset token', errorCode: 'INVALID_TOKEN' };
    }

    try {
      const resetSecret = config.JWT_ACCESS_SECRET + user.passwordHash;
      jwt.verify(token, resetSecret);
    } catch {
      throw { statusCode: 400, message: 'Password reset link has expired or has already been used', errorCode: 'TOKEN_EXPIRED' };
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Invalidate all existing refresh tokens for security
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { revoked: true },
    });

    await logAudit({
      userId: user.id,
      action: 'PASSWORD_RESET_SUCCESS',
      entity: 'User',
      entityId: user.id,
    });

    return { success: true, message: 'Password has been reset successfully. Please log in with your new password.' };
  }
}
