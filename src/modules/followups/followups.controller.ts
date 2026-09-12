import { Response, NextFunction } from 'express';
import { FollowUpsService } from './followups.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class FollowUpsController {
  static async createFollowUp(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const followUp = await FollowUpsService.createFollowUp(req.body, req.user!.userId);
      return sendSuccess(res, followUp, 'Follow-up created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateFollowUp(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const followUp = await FollowUpsService.updateFollowUp(req.params.id, req.body, req.user!.userId);
      return sendSuccess(res, followUp, 'Follow-up updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async listFollowUps(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const followUps = await FollowUpsService.listFollowUps({
        id: req.user!.userId,
        role: req.user!.role,
      });
      return sendSuccess(res, followUps, 'Follow-ups retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}
