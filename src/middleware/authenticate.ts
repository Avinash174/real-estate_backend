import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt.js';
import { prisma } from '../utils/prisma.js';
import { sendError } from '../utils/response.js';
import { AccountStatus } from '@prisma/client';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload & {
    id: string;
    managerId?: string | null;
  };
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      sendError(res, 'Authentication token missing or invalid', 'AUTH_TOKEN_MISSING', 401);
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, status: true, role: true, managerId: true },
    });

    if (!user) {
      sendError(res, 'User account not found', 'USER_NOT_FOUND', 401);
      return;
    }

    if (user.status !== AccountStatus.ACTIVE) {
      sendError(
        res,
        `Account is ${user.status.toLowerCase()}. Please contact administrator.`,
        'ACCOUNT_NOT_ACTIVE',
        403
      );
      return;
    }

    req.user = {
      ...decoded,
      id: user.id,
      managerId: user.managerId,
    };

    next();
  } catch (error: any) {
    sendError(res, 'Invalid or expired session token', 'TOKEN_EXPIRED', 401);
  }
};
