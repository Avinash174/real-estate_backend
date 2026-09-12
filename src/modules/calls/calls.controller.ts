import { Request, Response, NextFunction } from 'express';
import { CallsService } from './calls.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';
import { config } from '../../config/index.js';

export class CallsController {
  static async logCall(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const call = await CallsService.logCall({
        ...req.body,
        executiveId: req.user!.userId,
      });
      return sendSuccess(res, call, 'Call logged successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async listCalls(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await CallsService.listCalls(
        {
          page: Number(req.query.page),
          limit: Number(req.query.limit),
          leadId: req.query.leadId as string,
          executiveId: req.query.executiveId as string,
          outcome: req.query.outcome as any,
        },
        { id: req.user!.userId, role: req.user!.role }
      );
      return sendSuccess(res, result.calls, 'Calls retrieved successfully', 200, result.meta);
    } catch (error) {
      next(error);
    }
  }

  static async telephonyWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const { secret, providerCallId, recordingUrl, duration } = req.body;
      if (secret !== config.TELEPHONY_WEBHOOK_SECRET) {
        return sendError(res, 'Invalid webhook secret', 'INVALID_SECRET', 403);
      }

      const result = await CallsService.attachRecordingWebhook({
        providerCallId,
        recordingUrl,
        duration,
      });
      return sendSuccess(res, result, 'Telephony webhook processed');
    } catch (error) {
      next(error);
    }
  }
}
