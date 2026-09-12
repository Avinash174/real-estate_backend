import { Response, NextFunction } from 'express';
import { AssignmentsService } from './assignments.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class AssignmentsController {
  static async assignLead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { leadId, newExecutiveId, reason } = req.body;
      const result = await AssignmentsService.assignOrReassign({
        leadId,
        newExecutiveId,
        reason,
        assignedById: req.user!.userId,
        assignedByRole: req.user!.role,
      });

      return sendSuccess(res, result, 'Lead assigned successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const history = await AssignmentsService.getAssignmentHistory(req.params.leadId);
      return sendSuccess(res, history, 'Assignment history retrieved');
    } catch (error) {
      next(error);
    }
  }
}
