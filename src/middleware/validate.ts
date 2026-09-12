import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { sendError } from '../utils/response.js';

export const validate = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        sendError(
          res,
          'Validation error',
          'VALIDATION_ERROR',
          422,
          error.errors.map((e) => ({
            field: e.path.slice(1).join('.'),
            message: e.message,
          }))
        );
        return;
      }
      sendError(res, 'Internal validation error', 'INTERNAL_ERROR', 500);
    }
  };
};
