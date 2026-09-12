import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authenticate.js';
import { Role } from '@prisma/client';
import { sendError } from '../utils/response.js';

export const authorize = (allowedRoles: Role[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'Authentication required', 'UNAUTHENTICATED', 401);
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      sendError(
        res,
        'You do not have permission to perform this action',
        'FORBIDDEN',
        403
      );
      return;
    }

    next();
  };
};
