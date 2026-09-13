import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { NotificationPriority, Role } from '@prisma/client';
import { NotificationPayload, buildNotificationLinks } from './notification.types.js';
import { emitNotificationToUser, emitNotificationToRole } from '../../socket.js';

export class NotificationsService {
  /**
   * Helper: Check if user enabled notification for a given type/channel
   */
  private static async isNotificationEnabled(userId: string, type: string, priority: NotificationPriority = NotificationPriority.NORMAL) {
    // High and Urgent priority alerts bypass muted category preferences
    if (priority === NotificationPriority.URGENT) {
      return { inApp: true, push: true };
    }

    try {
      const pref = await prisma.notificationPreference.findUnique({
        where: { userId },
      });

      if (!pref) {
        return { inApp: true, push: true };
      }

      // Check category toggle
      let categoryAllowed = true;
      if (type.startsWith('LEAD_ASSIGNED') || type.startsWith('LEAD_REASSIGNED') || type.startsWith('LEAD_UNASSIGNED')) {
        categoryAllowed = pref.leadAssignment;
      } else if (type.startsWith('LEAD_')) {
        categoryAllowed = pref.leadStatus;
      } else if (type.startsWith('CALLBACK_')) {
        categoryAllowed = pref.callback;
      } else if (type.startsWith('FOLLOW_UP_')) {
        categoryAllowed = pref.followUp;
      } else if (type.startsWith('VISIT_')) {
        categoryAllowed = pref.visit;
      } else if (type.startsWith('REVISIT_')) {
        categoryAllowed = pref.revisit;
      } else if (type.startsWith('CALL_')) {
        categoryAllowed = pref.call;
      } else if (type.startsWith('BOOKING_')) {
        categoryAllowed = pref.booking;
      } else if (type.startsWith('PAYMENT_') || type.startsWith('INVOICE_')) {
        categoryAllowed = pref.payment;
      } else if (type.startsWith('TEAM_') || type.startsWith('EXECUTIVE_')) {
        categoryAllowed = pref.teamUpdates;
      } else if (type.startsWith('DAILY_') || type.startsWith('WEEKLY_')) {
        categoryAllowed = pref.dailySummary;
      } else if (type.startsWith('SYSTEM_') || type.startsWith('META_') || type.startsWith('SECURITY_')) {
        categoryAllowed = pref.systemAlerts;
      }

      if (!categoryAllowed && priority !== NotificationPriority.HIGH) {
        return { inApp: false, push: false };
      }

      return {
        inApp: pref.inApp,
        push: pref.push,
      };
    } catch (err) {
      logger.error('Error fetching notification preferences, defaulting to enabled:', err);
      return { inApp: true, push: true };
    }
  }

  /**
   * Dispatch push notification to registered FCM tokens
   * Wrapped in try/catch: push failure NEVER throws or breaks business transactions.
   */
  private static async dispatchFcmPush(
    notificationId: string,
    tokens: string[],
    payload: NotificationPayload,
    priority: NotificationPriority
  ) {
    if (!tokens || tokens.length === 0) return;

    for (const fcmToken of tokens) {
      let deliveryRecord;
      try {
        deliveryRecord = await prisma.notificationDelivery.create({
          data: {
            notificationId,
            channel: 'PUSH_FCM',
            recipient: fcmToken,
            status: 'PENDING',
          },
        });
      } catch (e) {
        logger.error('Failed to create notification delivery record:', e);
      }

      try {
        // If FCM Server Key is mock or empty, simulate dispatch
        if (!config.FCM_SERVER_KEY || config.FCM_SERVER_KEY === 'mock_fcm_key') {
          logger.info(`[FCM-MOCK] Push sent to token ${fcmToken.substring(0, 10)}...: "${payload.title}"`);
          if (deliveryRecord) {
            await prisma.notificationDelivery.update({
              where: { id: deliveryRecord.id },
              data: {
                status: 'SENT',
                deliveredAt: new Date(),
              },
            });
          }
          continue;
        }

        // Live FCM Legacy HTTP endpoint dispatch
        const fcmPayload = {
          to: fcmToken,
          priority: priority === NotificationPriority.URGENT || priority === NotificationPriority.HIGH ? 'high' : 'normal',
          notification: {
            title: payload.title,
            body: payload.body,
            sound: 'default',
          },
          data: {
            notificationId,
            type: payload.type,
            priority: priority,
            entityType: payload.entityType || '',
            entityId: payload.entityId || '',
            leadId: payload.leadId || '',
            deepLink: payload.deepLink || '',
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
            metadata: payload.metadata ? JSON.stringify(payload.metadata) : '',
          },
        };

        const response = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `key=${config.FCM_SERVER_KEY}`,
          },
          body: JSON.stringify(fcmPayload),
        });

        const resJson: any = await response.json().catch(() => ({}));

        if (response.ok && resJson?.success > 0) {
          if (deliveryRecord) {
            await prisma.notificationDelivery.update({
              where: { id: deliveryRecord.id },
              data: {
                status: 'SENT',
                deliveredAt: new Date(),
              },
            });
          }
        } else {
          const errorMsg = resJson?.results?.[0]?.error || `FCM error: HTTP ${response.status}`;
          logger.warn(`FCM delivery failed for token ${fcmToken.substring(0, 10)}...: ${errorMsg}`);

          // If token expired or invalid, deactivate device
          if (errorMsg === 'NotRegistered' || errorMsg === 'InvalidRegistration') {
            await prisma.userDevice.updateMany({
              where: { fcmToken },
              data: { isActive: false },
            });
          }

          if (deliveryRecord) {
            await prisma.notificationDelivery.update({
              where: { id: deliveryRecord.id },
              data: {
                status: 'FAILED',
                errorMessage: errorMsg,
              },
            });
          }
        }
      } catch (pushErr: any) {
        logger.error(`FCM exception for token ${fcmToken.substring(0, 10)}...:`, pushErr?.message || pushErr);
        if (deliveryRecord) {
          await prisma.notificationDelivery.update({
            where: { id: deliveryRecord.id },
            data: {
              status: 'FAILED',
              errorMessage: pushErr?.message || 'Network error',
            },
          }).catch(() => {});
        }
      }
    }
  }

  /**
   * Send notification to a specific user
   * Handles idempotency, preference filtering, database persistence, WebSocket dispatch, and FCM push.
   */
  static async sendToUser(userId: string, payload: NotificationPayload) {
    try {
      const priority = payload.priority || NotificationPriority.NORMAL;

      // 1. Idempotency Check
      if (payload.idempotencyKey) {
        const existing = await prisma.notification.findUnique({
          where: { idempotencyKey: payload.idempotencyKey },
        });
        if (existing) {
          logger.debug(`Notification with idempotencyKey "${payload.idempotencyKey}" already exists. Skipping.`);
          return existing;
        }
      }

      // 2. Preferences Check
      const permissions = await this.isNotificationEnabled(userId, payload.type, priority);
      if (!permissions.inApp && !permissions.push) {
        logger.debug(`User ${userId} disabled notifications for type "${payload.type}". Suppressing.`);
        return null;
      }

      // 3. Auto-build links if not explicitly provided
      const links = buildNotificationLinks({
        entityType: payload.entityType,
        entityId: payload.entityId,
        leadId: payload.leadId,
      });
      const deepLink = payload.deepLink || links.deepLink;
      const webLink = payload.webLink || links.webLink;

      // 4. In-App Notification Record in DB
      let notif = null;
      if (permissions.inApp) {
        notif = await prisma.notification.create({
          data: {
            userId,
            title: payload.title,
            body: payload.body,
            type: payload.type,
            priority,
            entityType: payload.entityType || null,
            entityId: payload.entityId || null,
            leadId: payload.leadId || null,
            idempotencyKey: payload.idempotencyKey || null,
            metadata: {
              ...(payload.metadata || {}),
              deepLink,
              webLink,
            },
          },
        });

        // 5. Emit live WebSocket event
        emitNotificationToUser(userId, notif);
      }

      // 6. Push Notification Dispatch
      if (permissions.push) {
        const devices = await prisma.userDevice.findMany({
          where: { userId, isActive: true },
          select: { fcmToken: true },
        });

        if (devices.length > 0) {
          const tokens = devices.map((d) => d.fcmToken);
          this.dispatchFcmPush(
            notif?.id || 'push-only',
            tokens,
            { ...payload, deepLink, webLink },
            priority
          ).catch((e) => logger.error('Async FCM dispatch error:', e));
        }
      }

      return notif;
    } catch (err) {
      logger.error(`Failed to send notification to user ${userId}:`, err);
      return null;
    }
  }

  /**
   * Send notification to multiple users
   */
  static async sendToUsers(userIds: string[], payload: NotificationPayload) {
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    const promises = uniqueIds.map((uid) => this.sendToUser(uid, payload));
    return Promise.allSettled(promises);
  }

  /**
   * Broadcast notification to all active users with a specific role
   */
  static async sendToRole(role: Role, payload: NotificationPayload) {
    try {
      const users = await prisma.user.findMany({
        where: { role },
        select: { id: true },
      });

      const userIds = users.map((u) => u.id);
      logger.info(`Dispatching notification "${payload.title}" to ${userIds.length} users with role ${role}`);

      // Emit room-wide socket event
      emitNotificationToRole(role, {
        ...payload,
        createdAt: new Date().toISOString(),
      });

      // Send to each user for DB persistence and FCM
      return this.sendToUsers(userIds, payload);
    } catch (err) {
      logger.error(`Error sending notification to role ${role}:`, err);
    }
  }

  /**
   * Send notification to assigned executive and their manager/admins
   */
  static async sendToManagerAndTeam(leadId: string, payload: NotificationPayload) {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          assignedExecutiveId: true,
        },
      });

      const recipientIds = new Set<string>();

      if (lead?.assignedExecutiveId) {
        recipientIds.add(lead.assignedExecutiveId);
      }

      // Also notify managers and admins
      const managers = await prisma.user.findMany({
        where: {
          role: { in: [Role.MANAGER, Role.ADMIN] },
        },
        select: { id: true },
      });

      managers.forEach((m) => recipientIds.add(m.id));

      return this.sendToUsers(Array.from(recipientIds), {
        ...payload,
        leadId,
      });
    } catch (err) {
      logger.error(`Error sending notification to manager and team for lead ${leadId}:`, err);
    }
  }

  /**
   * List notifications with search, filters, and pagination
   */
  static async listNotifications(
    userId: string,
    filters?: {
      type?: string;
      isRead?: boolean;
      priority?: NotificationPriority;
      search?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const page = Math.max(filters?.page || 1, 1);
    const limit = Math.min(filters?.limit || 30, 100);
    const skip = (page - 1) * limit;

    const where: any = { userId };

    if (filters?.type) {
      where.type = filters.type;
    }
    if (typeof filters?.isRead === 'boolean') {
      where.isRead = filters.isRead;
    }
    if (filters?.priority) {
      where.priority = filters.priority;
    }
    if (filters?.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { body: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      notifications,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get unread notifications count
   */
  static async getUnreadCount(userId: string) {
    const count = await prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount: count };
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(id: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id, userId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Delete a single notification
   */
  static async deleteNotification(id: string, userId: string) {
    return prisma.notification.deleteMany({
      where: { id, userId },
    });
  }

  /**
   * Register or refresh user device FCM token
   */
  static async registerDevice(
    userId: string,
    fcmToken: string,
    deviceType = 'MOBILE',
    deviceName?: string,
    appVersion?: string
  ) {
    return prisma.userDevice.upsert({
      where: { fcmToken },
      update: {
        userId,
        deviceType,
        deviceName: deviceName || null,
        appVersion: appVersion || null,
        isActive: true,
        lastActive: new Date(),
      },
      create: {
        userId,
        fcmToken,
        deviceType,
        deviceName: deviceName || null,
        appVersion: appVersion || null,
        isActive: true,
      },
    });
  }

  /**
   * Unregister FCM token on logout or permission revoke
   */
  static async unregisterDevice(userId: string, fcmToken: string) {
    return prisma.userDevice.updateMany({
      where: { userId, fcmToken },
      data: { isActive: false },
    });
  }

  /**
   * Get user notification preferences (creates default if not exists)
   */
  static async getPreferences(userId: string) {
    let prefs = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    if (!prefs) {
      prefs = await prisma.notificationPreference.create({
        data: { userId },
      });
    }

    return prefs;
  }

  /**
   * Update user notification preferences
   */
  static async updatePreferences(userId: string, data: any) {
    return prisma.notificationPreference.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        ...data,
      },
    });
  }

  /**
   * Backward-compatible helper for push notification dispatch
   */
  static async sendPushNotification(userId: string, title: string, body: string, type: string, metadata?: any) {
    return this.sendToUser(userId, {
      title,
      body,
      type,
      metadata,
    });
  }
}
