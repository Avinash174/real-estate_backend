import { Response, NextFunction } from 'express';
import { ReportsService } from './reports.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';
import { Role } from '@prisma/client';

export class ReportsController {
  static async getDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { preset, from, to } = req.query as { preset?: string; from?: string; to?: string };
      const role = req.user!.role;

      if (role === Role.ADMIN) {
        const data = await ReportsService.getAdminDashboard(preset, from, to);
        return sendSuccess(res, data, 'Admin dashboard metrics retrieved');
      } else if (role === Role.MANAGER) {
        const data = await ReportsService.getManagerDashboard(req.user!.userId, preset, from, to);
        return sendSuccess(res, data, 'Manager dashboard metrics retrieved');
      } else {
        const data = await ReportsService.getExecutiveDashboard(req.user!.userId);
        return sendSuccess(res, data, 'Executive dashboard metrics retrieved');
      }
    } catch (error) {
      next(error);
    }
  }

  static async getSourceReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { preset, from, to } = req.query as { preset?: string; from?: string; to?: string };
      const data = await ReportsService.getSourceReport(preset, from, to);
      return sendSuccess(res, data, 'Source report retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}
