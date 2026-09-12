import { Response, NextFunction } from 'express';
import { LeadsService } from './leads.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class LeadsController {
  static async checkDuplicate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const mobile = req.query.mobile as string;
      const email = req.query.email as string | undefined;

      const result = await LeadsService.checkDuplicate(mobile, email);
      return sendSuccess(res, result, 'Duplicate check completed');
    } catch (error) {
      next(error);
    }
  }

  static async createLead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const lead = await LeadsService.createLead(req.body, req.user!.userId);
      return sendSuccess(res, lead, 'Lead created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async listLeads(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await LeadsService.listLeads(
        {
          page: Number(req.query.page),
          limit: Number(req.query.limit),
          search: req.query.search as string,
          status: req.query.status as any,
          source: req.query.source as any,
          priority: req.query.priority as any,
          managerId: req.query.managerId as string,
          executiveId: req.query.executiveId as string,
          from: req.query.from as string,
          to: req.query.to as string,
        },
        {
          id: req.user!.userId,
          role: req.user!.role,
          managerId: req.user!.managerId,
        }
      );

      return sendSuccess(res, result.leads, 'Leads fetched successfully', 200, result.meta);
    } catch (error) {
      next(error);
    }
  }

  static async getLeadById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const lead = await LeadsService.getLeadById(req.params.id, {
        id: req.user!.userId,
        role: req.user!.role,
      });
      return sendSuccess(res, lead, 'Lead retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { status, remarks, lossReason, estimatedLossAmount } = req.body;
      const lead = await LeadsService.updateStatus(
        req.params.id,
        status,
        remarks,
        lossReason,
        estimatedLossAmount,
        { id: req.user!.userId, role: req.user!.role }
      );
      return sendSuccess(res, lead, 'Lead status updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async addNote(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const note = await LeadsService.addNote(req.params.id, req.body.note, req.user!.userId);
      return sendSuccess(res, note, 'Note added successfully', 201);
    } catch (error) {
      next(error);
    }
  }
}
