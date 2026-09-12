import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { sendError } from '../utils/response.js';
import { Prisma } from '@prisma/client';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logger.error('Unhandled Exception Caught:', {
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
  });

  // Prisma Known Request Error
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[])?.join(', ') || 'field';
      sendError(res, `A record with this ${target} already exists.`, 'DUPLICATE_ENTRY', 409);
      return;
    }
    if (err.code === 'P2025') {
      sendError(res, 'Record requested was not found', 'NOT_FOUND', 404);
      return;
    }
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    sendError(res, 'Invalid authorization token', 'AUTH_INVALID_TOKEN', 401);
    return;
  }
  if (err.name === 'TokenExpiredError') {
    sendError(res, 'Authorization token has expired', 'AUTH_TOKEN_EXPIRED', 401);
    return;
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'An unexpected error occurred';
  sendError(res, message, err.errorCode || 'INTERNAL_SERVER_ERROR', statusCode);
};
