import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationType } from './notification.types.js';
import { NotificationPriority, CallbackStatus, FollowUpStatus, VisitStatus } from '@prisma/client';

export class NotificationScheduler {
  private static intervalTimer: NodeJS.Timeout | null = null;
  private static isRunning = false;

  static start(intervalMs = 60000) {
    if (this.intervalTimer) {
      logger.info('NotificationScheduler is already running.');
      return;
    }

    logger.info(`Starting NotificationScheduler (frequency: ${intervalMs / 1000}s)...`);
    // Run an initial tick immediately
    this.tick().catch((e) => logger.error('Error in initial NotificationScheduler tick:', e));

    this.intervalTimer = setInterval(() => {
      this.tick().catch((e) => logger.error('Error in NotificationScheduler interval tick:', e));
    }, intervalMs);
  }

  static stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      logger.info('NotificationScheduler stopped.');
    }
  }

  private static parseScheduledDateTime(date: Date, timeStr?: string | null): Date {
    const d = new Date(date);
    if (timeStr && timeStr.includes(':')) {
      const parts = timeStr.split(':').map(Number);
      if (!isNaN(parts[0]) && !isNaN(parts[1])) {
        d.setHours(parts[0], parts[1], 0, 0);
        return d;
      }
    }
    return d;
  }

  private static async tick() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const now = new Date();
      // Look back 24 hours and forward 24 hours
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await Promise.allSettled([
        this.checkCallbacks(now, windowStart, windowEnd),
        this.checkFollowUps(now, windowStart, windowEnd),
        this.checkVisits(now, windowStart, windowEnd),
      ]);
    } catch (error) {
      logger.error('NotificationScheduler tick error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 1. Check Callbacks: 15m reminder & overdue check
   */
  private static async checkCallbacks(now: Date, windowStart: Date, windowEnd: Date) {
    try {
      const callbacks = await prisma.callback.findMany({
        where: {
          status: CallbackStatus.SCHEDULED,
          callbackDate: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
        include: {
          lead: {
            select: {
              id: true,
              leadNumber: true,
              customer: { select: { name: true, phone: true } },
            },
          },
        },
      });

      for (const cb of callbacks) {
        const scheduledAt = this.parseScheduledDateTime(cb.callbackDate, cb.callbackTime);
        const diffMinutes = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);
        const customerName = cb.lead.customer?.name || cb.lead.leadNumber;
        const customerPhone = cb.lead.customer?.phone || '';

        // A. 15-minute upcoming reminder: between 0 and 15 mins
        if (diffMinutes <= 15 && diffMinutes >= 0) {
          const reminderKey = `cb_reminder_${cb.id}`;
          await NotificationsService.sendToUser(cb.assignedExecutiveId, {
            title: `Callback in ${Math.max(1, Math.round(diffMinutes))} mins: ${customerName}`,
            body: `You have a scheduled callback with ${customerName} (${customerPhone}) at ${cb.callbackTime || 'soon'}.`,
            type: NotificationType.CALLBACK_DUE,
            priority: NotificationPriority.HIGH,
            entityType: 'CALLBACK',
            entityId: cb.id,
            leadId: cb.leadId,
            idempotencyKey: reminderKey,
          });
        }

        // B. Overdue alert: scheduled time was more than 10 mins ago
        if (diffMinutes <= -10) {
          const overdueKey = `cb_overdue_${cb.id}`;
          // Send to executive
          await NotificationsService.sendToUser(cb.assignedExecutiveId, {
            title: `⚠️ Callback Overdue: ${customerName}`,
            body: `The callback with ${customerName} scheduled for ${cb.callbackTime || 'earlier'} has not been initiated.`,
            type: NotificationType.CALLBACK_OVERDUE,
            priority: NotificationPriority.URGENT,
            entityType: 'CALLBACK',
            entityId: cb.id,
            leadId: cb.leadId,
            idempotencyKey: overdueKey,
          });

          // Also alert managers/team if overdue by 20+ mins
          if (diffMinutes <= -20) {
            const managerOverdueKey = `cb_manager_overdue_${cb.id}`;
            await NotificationsService.sendToManagerAndTeam(cb.leadId, {
              title: `🚨 Escalation: Callback Overdue for ${customerName}`,
              body: `Lead callback is overdue by ${Math.abs(Math.round(diffMinutes))} mins.`,
              type: NotificationType.CALLBACK_OVERDUE,
              priority: NotificationPriority.URGENT,
              entityType: 'CALLBACK',
              entityId: cb.id,
              leadId: cb.leadId,
              idempotencyKey: managerOverdueKey,
            });
          }
        }
      }
    } catch (e) {
      logger.error('Error checking callbacks in scheduler:', e);
    }
  }

  /**
   * 2. Check Follow-ups: 30m reminder & overdue check
   */
  private static async checkFollowUps(now: Date, windowStart: Date, windowEnd: Date) {
    try {
      const followUps = await prisma.followUp.findMany({
        where: {
          status: FollowUpStatus.PENDING,
          followUpDate: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
        include: {
          lead: {
            select: {
              id: true,
              leadNumber: true,
              customer: { select: { name: true, phone: true } },
            },
          },
        },
      });

      for (const fu of followUps) {
        const scheduledAt = this.parseScheduledDateTime(fu.followUpDate, fu.followUpTime);
        const diffMinutes = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);
        const customerName = fu.lead.customer?.name || fu.lead.leadNumber;
        const customerPhone = fu.lead.customer?.phone || '';

        // A. 30-minute reminder
        if (diffMinutes <= 30 && diffMinutes >= 0) {
          const reminderKey = `fu_reminder_${fu.id}`;
          await NotificationsService.sendToUser(fu.executiveId, {
            title: `Follow-up in ${Math.max(1, Math.round(diffMinutes))} mins: ${customerName}`,
            body: `Upcoming ${fu.type} follow-up scheduled with ${customerName} (${customerPhone}).`,
            type: NotificationType.FOLLOW_UP_DUE,
            priority: NotificationPriority.NORMAL,
            entityType: 'FOLLOWUP',
            entityId: fu.id,
            leadId: fu.leadId,
            idempotencyKey: reminderKey,
          });
        }

        // B. Overdue alert (15+ mins past)
        if (diffMinutes <= -15) {
          const overdueKey = `fu_overdue_${fu.id}`;
          await NotificationsService.sendToUser(fu.executiveId, {
            title: `⚠️ Follow-up Overdue: ${customerName}`,
            body: `Follow-up with ${customerName} was scheduled for ${fu.followUpTime || 'earlier'} and is overdue.`,
            type: NotificationType.FOLLOW_UP_OVERDUE,
            priority: NotificationPriority.HIGH,
            entityType: 'FOLLOWUP',
            entityId: fu.id,
            leadId: fu.leadId,
            idempotencyKey: overdueKey,
          });
        }
      }
    } catch (e) {
      logger.error('Error checking follow-ups in scheduler:', e);
    }
  }

  /**
   * 3. Check Site Visits: 1-hour reminder & missed check
   */
  private static async checkVisits(now: Date, windowStart: Date, windowEnd: Date) {
    try {
      const visits = await prisma.visit.findMany({
        where: {
          status: VisitStatus.SCHEDULED,
          visitDate: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
        include: {
          lead: {
            select: {
              id: true,
              leadNumber: true,
              customer: { select: { name: true, phone: true } },
            },
          },
        },
      });

      for (const v of visits) {
        const scheduledAt = this.parseScheduledDateTime(v.visitDate, v.visitTime);
        const diffMinutes = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);
        const customerName = v.lead.customer?.name || v.lead.leadNumber;

        // A. 60-minute reminder
        if (diffMinutes <= 60 && diffMinutes >= 0) {
          const reminderKey = `visit_reminder_${v.id}`;
          await NotificationsService.sendToUser(v.executiveId, {
            title: `Site Visit in ${Math.max(1, Math.round(diffMinutes))} mins: ${customerName}`,
            body: `Site visit scheduled with ${customerName} at ${v.address || 'location'}.`,
            type: NotificationType.VISIT_REMINDER,
            priority: NotificationPriority.HIGH,
            entityType: 'VISIT',
            entityId: v.id,
            leadId: v.leadId,
            idempotencyKey: reminderKey,
          });
        }

        // B. Missed alert: 2 hours overdue without checkIn
        if (diffMinutes <= -120 && !v.checkInTime) {
          const missedKey = `visit_missed_${v.id}`;
          await NotificationsService.sendToUser(v.executiveId, {
            title: `🚨 Site Visit Marked Missed: ${customerName}`,
            body: `No check-in recorded for site visit scheduled at ${v.visitTime || 'earlier'}.`,
            type: NotificationType.VISIT_MISSED,
            priority: NotificationPriority.URGENT,
            entityType: 'VISIT',
            entityId: v.id,
            leadId: v.leadId,
            idempotencyKey: missedKey,
          });
        }
      }
    } catch (e) {
      logger.error('Error checking visits in scheduler:', e);
    }
  }
}
