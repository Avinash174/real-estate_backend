import { Response, NextFunction } from 'express';
import { TrackingService } from './tracking.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class TrackingController {
  static async updateLocation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await TrackingService.updateLocation({
        userId: req.user!.userId,
        ...req.body,
      });
      return sendSuccess(res, result, 'Location recorded successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getLiveTracking(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await TrackingService.getLiveTracking({
        id: req.user!.userId,
        role: req.user!.role,
        managerId: req.user!.managerId,
      });
      return sendSuccess(res, result, 'Live tracking locations retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await TrackingService.getHistory(
        req.params.executiveId,
        req.query.date as string,
        { id: req.user!.userId, role: req.user!.role }
      );
      return sendSuccess(res, result, 'Executive route history retrieved');
    } catch (error) {
      next(error);
    }
  }
}
