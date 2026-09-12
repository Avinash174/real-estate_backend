import { Response, NextFunction } from 'express';
import { VisitsService } from './visits.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class VisitsController {
  static async scheduleVisit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const visit = await VisitsService.scheduleVisit(req.body, req.user!.userId);
      return sendSuccess(res, visit, 'Visit scheduled successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async startVisit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const visit = await VisitsService.startVisit(req.params.id, req.body, req.user!.userId);
      return sendSuccess(res, visit, 'Visit checked in successfully');
    } catch (error) {
      next(error);
    }
  }

  static async completeVisit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const visit = await VisitsService.completeVisit(req.params.id, req.body, req.user!.userId);
      return sendSuccess(res, visit, 'Visit checked out and completed successfully');
    } catch (error) {
      next(error);
    }
  }

  static async scheduleRevisit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const revisit = await VisitsService.scheduleRevisit(req.body, req.user!.userId);
      return sendSuccess(res, revisit, 'Revisit scheduled successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async listVisits(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const visits = await VisitsService.listVisits({
        id: req.user!.userId,
        role: req.user!.role,
      });
      return sendSuccess(res, visits, 'Visits retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}
