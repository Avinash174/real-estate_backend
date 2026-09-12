import { Response, NextFunction } from 'express';
import { NotificationsService } from './notifications.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class NotificationsController {
  static async listNotifications(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const notifs = await NotificationsService.listNotifications(req.user!.userId);
      return sendSuccess(res, notifs, 'Notifications retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async markAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await NotificationsService.markAsRead(req.params.id, req.user!.userId);
      return sendSuccess(res, null, 'Marked as read');
    } catch (error) {
      next(error);
    }
  }

  static async markAllAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await NotificationsService.markAllAsRead(req.user!.userId);
      return sendSuccess(res, null, 'All marked as read');
    } catch (error) {
      next(error);
    }
  }

  static async registerDevice(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { fcmToken, deviceType } = req.body;
      const device = await NotificationsService.registerDevice(req.user!.userId, fcmToken, deviceType);
      return sendSuccess(res, device, 'Device registered for notifications');
    } catch (error) {
      next(error);
    }
  }
}
