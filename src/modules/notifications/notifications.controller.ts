import { Response, NextFunction } from 'express';
import { NotificationsService } from './notifications.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';
import { NotificationPriority } from '@prisma/client';

export class NotificationsController {
  static async listNotifications(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { type, isRead, priority, search, page, limit } = req.query;

      const filters = {
        type: type ? String(type) : undefined,
        isRead: isRead !== undefined ? isRead === 'true' : undefined,
        priority: priority ? (String(priority) as NotificationPriority) : undefined,
        search: search ? String(search) : undefined,
        page: page ? parseInt(String(page), 10) : 1,
        limit: limit ? parseInt(String(limit), 10) : 30,
      };

      const result = await NotificationsService.listNotifications(req.user!.userId, filters);
      return sendSuccess(res, result, 'Notifications retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getUnreadCount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const count = await NotificationsService.getUnreadCount(req.user!.userId);
      return sendSuccess(res, count, 'Unread count retrieved');
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

  static async deleteNotification(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await NotificationsService.deleteNotification(req.params.id, req.user!.userId);
      return sendSuccess(res, null, 'Notification deleted');
    } catch (error) {
      next(error);
    }
  }

  static async registerDevice(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { fcmToken, deviceType, deviceName, appVersion } = req.body;
      if (!fcmToken) {
        return res.status(400).json({ success: false, message: 'fcmToken is required' });
      }
      const device = await NotificationsService.registerDevice(
        req.user!.userId,
        fcmToken,
        deviceType || 'MOBILE',
        deviceName,
        appVersion
      );
      return sendSuccess(res, device, 'Device registered for notifications');
    } catch (error) {
      next(error);
    }
  }

  static async unregisterDevice(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { fcmToken } = req.params;
      await NotificationsService.unregisterDevice(req.user!.userId, fcmToken);
      return sendSuccess(res, null, 'Device unregistered');
    } catch (error) {
      next(error);
    }
  }

  static async getPreferences(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const preferences = await NotificationsService.getPreferences(req.user!.userId);
      return sendSuccess(res, preferences, 'Notification preferences retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async updatePreferences(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const preferences = await NotificationsService.updatePreferences(req.user!.userId, req.body);
      return sendSuccess(res, preferences, 'Notification preferences updated');
    } catch (error) {
      next(error);
    }
  }
}
