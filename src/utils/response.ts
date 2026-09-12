import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  errorCode?: string;
  errors?: any;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export const sendSuccess = <T>(
  res: Response,
  data?: T,
  message = 'Success',
  statusCode = 200,
  meta?: ApiResponse['meta']
): Response => {
  const responseBody: ApiResponse<T> = {
    success: true,
    message,
    ...(data !== undefined && { data }),
    ...(meta !== undefined && { meta }),
  };
  return res.status(statusCode).json(responseBody);
};

export const sendError = (
  res: Response,
  message = 'An error occurred',
  errorCode = 'INTERNAL_ERROR',
  statusCode = 500,
  errors?: any
): Response => {
  const responseBody: ApiResponse = {
    success: false,
    message,
    errorCode,
    ...(errors !== undefined && { errors }),
  };
  return res.status(statusCode).json(responseBody);
};
