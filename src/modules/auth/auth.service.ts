import bcrypt from 'bcryptjs';
import { prisma } from '../../utils/prisma.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import { logAudit } from '../../utils/audit.js';
import { AccountStatus } from '@prisma/client';

export class AuthService {
  static async login(email: string, password: string, ipAddress?: string, userAgent?: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { manager: { select: { id: true, name: true } } },
    });

    if (!user) {
      throw { statusCode: 401, message: 'Invalid email or password', errorCode: 'AUTH_INVALID_CREDENTIALS' };
    }

    if (user.status !== AccountStatus.ACTIVE) {
      throw {
        statusCode: 403,
        message: `Account is ${user.status.toLowerCase()}. Please contact administrator.`,
        errorCode: 'ACCOUNT_INACTIVE',
      };
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw { statusCode: 401, message: 'Invalid email or password', errorCode: 'AUTH_INVALID_CREDENTIALS' };
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Save refresh token in database
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt,
      },
    });

    await logAudit({
      userId: user.id,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      ipAddress,
      userAgent,
      newValue: { role: user.role, email: user.email },
    });

    return {
      user: {
        id: user.id,
        employeeId: user.employeeId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        designation: user.designation,
        avatar: user.avatar,
        managerId: user.managerId,
        manager: user.manager,
      },
      tokens: {
        accessToken,
        refreshToken,
      },
    };
  }

  static async refreshTokens(incomingRefreshToken: string) {
    try {
      const decoded = verifyRefreshToken(incomingRefreshToken);

      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: incomingRefreshToken },
        include: { user: true },
      });

      if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
        throw { statusCode: 401, message: 'Refresh token is invalid or expired', errorCode: 'AUTH_REFRESH_INVALID' };
      }

      if (storedToken.user.status !== AccountStatus.ACTIVE) {
        throw { statusCode: 403, message: 'Account is not active', errorCode: 'ACCOUNT_INACTIVE' };
      }

      // Token rotation: revoke old token
      await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revoked: true },
      });

      const tokenPayload = {
        userId: storedToken.user.id,
        email: storedToken.user.email,
        role: storedToken.user.role,
        employeeId: storedToken.user.employeeId,
      };

      const newAccessToken = generateAccessToken(tokenPayload);
      const newRefreshToken = generateRefreshToken(tokenPayload);

      await prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: storedToken.user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw { statusCode: 401, message: 'Invalid refresh token', errorCode: 'AUTH_REFRESH_FAILED' };
    }
  }

  static async logout(refreshToken: string, userId?: string, ip?: string, ua?: string) {
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken },
        data: { revoked: true },
      });
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

  static async getCurrentUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        designation: true,
        avatar: true,
        managerId: true,
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

    return user;
  }
}
