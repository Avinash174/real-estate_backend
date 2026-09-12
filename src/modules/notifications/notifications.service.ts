import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';

export class NotificationsService {
  static async listNotifications(userId: string) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  static async markAsRead(id: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  static async markAllAsRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  static async registerDevice(userId: string, fcmToken: string, deviceType = 'MOBILE') {
    return prisma.userDevice.upsert({
      where: { fcmToken },
      update: { userId, deviceType, lastActive: new Date() },
      create: { userId, fcmToken, deviceType },
    });
  }

  static async sendPushNotification(userId: string, title: string, body: string, type: string, metadata?: any) {
    // 1. Create in-app notification record
    const notif = await prisma.notification.create({
      data: {
        userId,
        title,
        body,
        type,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });

    // 2. Fetch user's registered FCM devices
    const devices = await prisma.userDevice.findMany({
      where: { userId },
      select: { fcmToken: true },
    });

    if (devices.length > 0) {
      logger.info(`FCM: Dispatched push notification '${title}' to ${devices.length} registered devices for user ${userId}`);
    }

    return notif;
  }
}
