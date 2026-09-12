import { Response, NextFunction } from 'express';
import { CallbacksService } from './callbacks.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class CallbacksController {
  static async createCallback(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const callback = await CallbacksService.createCallback(req.body, req.user!.userId);
      return sendSuccess(res, callback, 'Callback scheduled successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateCallback(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const callback = await CallbacksService.updateCallback(req.params.id, req.body, req.user!.userId);
      return sendSuccess(res, callback, 'Callback updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async listCallbacks(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const callbacks = await CallbacksService.listCallbacks({
        id: req.user!.userId,
        role: req.user!.role,
      });
      return sendSuccess(res, callbacks, 'Callbacks retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}
