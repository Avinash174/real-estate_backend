import EventEmitter from 'events';
import { logger } from '../../utils/logger.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationType, buildNotificationLinks } from './notification.types.js';
import { NotificationPriority, Role } from '@prisma/client';

class NotificationEventEmitter extends EventEmitter {}

export const notificationEmitter = new NotificationEventEmitter();

// Increase max listeners for application-wide event dispatching
notificationEmitter.setMaxListeners(50);

/**
 * Register all event listeners on notificationEmitter
 */
export const registerNotificationEventListeners = () => {
  // 1. LEAD ASSIGNED / REASSIGNED
  notificationEmitter.on('lead.assigned', async (event: {
    leadId: string;
    newExecutiveId: string;
    previousExecutiveId?: string | null;
    assignedById: string;
    reason?: string;
    leadNumber: string;
    customerName?: string;
    managerId?: string | null;
  }) => {
    try {
      const isReassignment = Boolean(event.previousExecutiveId);
      const links = buildNotificationLinks({ leadId: event.leadId, entityType: 'LEAD', entityId: event.leadId });

      // Notify New Executive
      await NotificationsService.sendToUser(event.newExecutiveId, {
        title: isReassignment ? 'Lead Reassigned to You' : 'New Lead Assigned',
        body: `Lead ${event.leadNumber} (${event.customerName || 'Customer'}) has been assigned to you.${event.reason ? ` Reason: ${event.reason}` : ''}`,
        type: isReassignment ? NotificationType.LEAD_REASSIGNED : NotificationType.LEAD_ASSIGNED,
        priority: NotificationPriority.HIGH,
        entityType: 'LEAD',
        entityId: event.leadId,
        leadId: event.leadId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        metadata: event,
      });

      // If reassigned, notify previous executive
      if (isReassignment && event.previousExecutiveId) {
        await NotificationsService.sendToUser(event.previousExecutiveId, {
          title: 'Lead Reassigned',
          body: `Lead ${event.leadNumber} has been reassigned.${event.reason ? ` Reason: ${event.reason}` : ''}`,
          type: NotificationType.LEAD_REASSIGNED,
          priority: NotificationPriority.NORMAL,
          entityType: 'LEAD',
          entityId: event.leadId,
          leadId: event.leadId,
          deepLink: links.deepLink,
          webLink: links.webLink,
          metadata: event,
        });
      }

      // Notify Manager if assigned by someone else (e.g. system round-robin or admin)
      if (event.managerId && event.assignedById !== event.managerId) {
        await NotificationsService.sendToUser(event.managerId, {
          title: 'Team Lead Assigned',
          body: `Lead ${event.leadNumber} assigned to executive.`,
          type: NotificationType.LEAD_ASSIGNED,
          priority: NotificationPriority.NORMAL,
          entityType: 'LEAD',
          entityId: event.leadId,
          leadId: event.leadId,
          deepLink: links.deepLink,
          webLink: links.webLink,
        });
      }
    } catch (err: any) {
      logger.error(`Error in lead.assigned notification handler: ${err.message}`);
    }
  });

  // 2. LEAD STATUS CHANGED (Meaningful status changes)
  notificationEmitter.on('lead.status.changed', async (event: {
    leadId: string;
    leadNumber: string;
    previousStatus: string;
    newStatus: string;
    customerName?: string;
    managerId?: string | null;
    executiveId?: string | null;
    remarks?: string;
  }) => {
    try {
      const highPriorityStatuses = ['BOOKING', 'CLOSED', 'LOST', 'POSITIVE'];
      const isHighPriority = highPriorityStatuses.includes(event.newStatus);
      const links = buildNotificationLinks({ leadId: event.leadId, entityType: 'LEAD' });

      const payload = {
        title: `Lead Status Updated: ${event.newStatus}`,
        body: `${event.customerName || event.leadNumber} status changed from ${event.previousStatus} to ${event.newStatus}.${event.remarks ? ` Note: ${event.remarks}` : ''}`,
        type: NotificationType.LEAD_STATUS_CHANGED,
        priority: isHighPriority ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
        entityType: 'LEAD',
        entityId: event.leadId,
        leadId: event.leadId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        metadata: event,
      };

      // Notify assigned manager
      if (event.managerId) {
        await NotificationsService.sendToUser(event.managerId, payload);
      }
    } catch (err: any) {
      logger.error(`Error in lead.status.changed notification handler: ${err.message}`);
    }
  });

  // 3. CALLBACK EVENTS (Created, Due, Overdue)
  notificationEmitter.on('callback.created', async (event: {
    callbackId: string;
    leadId: string;
    executiveId: string;
    callbackDate: string;
    callbackTime: string;
    customerName?: string;
  }) => {
    try {
      const links = buildNotificationLinks({ leadId: event.leadId, entityType: 'CALLBACK', entityId: event.callbackId });
      await NotificationsService.sendToUser(event.executiveId, {
        title: 'Callback Scheduled',
        body: `Callback with ${event.customerName || 'Customer'} scheduled for ${event.callbackDate} at ${event.callbackTime}.`,
        type: NotificationType.CALLBACK_CREATED,
        priority: NotificationPriority.NORMAL,
        entityType: 'CALLBACK',
        entityId: event.callbackId,
        leadId: event.leadId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        idempotencyKey: `callback:created:${event.callbackId}`,
      });
    } catch (err: any) {
      logger.error(`Error in callback.created notification handler: ${err.message}`);
    }
  });

  notificationEmitter.on('callback.due', async (event: {
    callbackId: string;
    leadId: string;
    executiveId: string;
    customerName?: string;
    timeStr?: string;
  }) => {
    try {
      const links = buildNotificationLinks({ leadId: event.leadId, entityType: 'CALLBACK', entityId: event.callbackId });
      await NotificationsService.sendToUser(event.executiveId, {
        title: 'Callback Due Now',
        body: `Your scheduled callback with ${event.customerName || 'Customer'} is due now (${event.timeStr || ''}).`,
        type: NotificationType.CALLBACK_DUE,
        priority: NotificationPriority.HIGH,
        entityType: 'CALLBACK',
        entityId: event.callbackId,
        leadId: event.leadId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        idempotencyKey: `callback:due:${event.callbackId}`,
      });
    } catch (err: any) {
      logger.error(`Error in callback.due notification handler: ${err.message}`);
    }
  });

  notificationEmitter.on('callback.overdue', async (event: {
    callbackId: string;
    leadId: string;
    executiveId: string;
    managerId?: string | null;
    customerName?: string;
  }) => {
    try {
      const links = buildNotificationLinks({ leadId: event.leadId, entityType: 'CALLBACK', entityId: event.callbackId });
      // Notify executive
      await NotificationsService.sendToUser(event.executiveId, {
        title: 'Callback Overdue',
        body: `Callback with ${event.customerName || 'Customer'} has passed its scheduled time and is overdue.`,
        type: NotificationType.CALLBACK_OVERDUE,
        priority: NotificationPriority.HIGH,
        entityType: 'CALLBACK',
        entityId: event.callbackId,
        leadId: event.leadId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        idempotencyKey: `callback:overdue:${event.callbackId}`,
      });

      // Also notify manager if team supervision is needed
      if (event.managerId) {
        await NotificationsService.sendToUser(event.managerId, {
          title: 'Team Callback Overdue',
          body: `An executive callback for ${event.customerName || 'Customer'} is overdue.`,
          type: NotificationType.CALLBACK_OVERDUE,
          priority: NotificationPriority.NORMAL,
          entityType: 'CALLBACK',
          entityId: event.callbackId,
          leadId: event.leadId,
          deepLink: links.deepLink,
          webLink: links.webLink,
          idempotencyKey: `callback:overdue:mgr:${event.callbackId}`,
        });
      }
    } catch (err: any) {
      logger.error(`Error in callback.overdue notification handler: ${err.message}`);
    }
  });

  // 4. FOLLOW-UP EVENTS
  notificationEmitter.on('followup.created', async (event: {
    followUpId: string;
    leadId: string;
    executiveId: string;
    followUpDate: string;
    customerName?: string;
  }) => {
    try {
      const links = buildNotificationLinks({ leadId: event.leadId, entityType: 'FOLLOWUP', entityId: event.followUpId });
      await NotificationsService.sendToUser(event.executiveId, {
        title: 'Follow-up Scheduled',
        body: `Follow-up with ${event.customerName || 'Customer'} scheduled for ${event.followUpDate}.`,
        type: NotificationType.FOLLOW_UP_CREATED,
        priority: NotificationPriority.NORMAL,
        entityType: 'FOLLOWUP',
        entityId: event.followUpId,
        leadId: event.leadId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        idempotencyKey: `followup:created:${event.followUpId}`,
      });
    } catch (err: any) {
      logger.error(`Error in followup.created notification handler: ${err.message}`);
    }
  });

  // 5. SITE VISIT EVENTS
  notificationEmitter.on('visit.scheduled', async (event: {
    visitId: string;
    leadId: string;
    executiveId: string;
    managerId?: string | null;
    visitDate: string;
    address: string;
    customerName?: string;
  }) => {
    try {
      const links = buildNotificationLinks({ leadId: event.leadId, entityType: 'VISIT', entityId: event.visitId });
      // Notify executive
      await NotificationsService.sendToUser(event.executiveId, {
        title: 'Site Visit Scheduled',
        body: `Property visit with ${event.customerName || 'Customer'} scheduled on ${event.visitDate} at ${event.address}.`,
        type: NotificationType.VISIT_SCHEDULED,
        priority: NotificationPriority.NORMAL,
        entityType: 'VISIT',
        entityId: event.visitId,
        leadId: event.leadId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        idempotencyKey: `visit:scheduled:${event.visitId}`,
      });

      // Notify manager
      if (event.managerId) {
        await NotificationsService.sendToUser(event.managerId, {
          title: 'Team Site Visit Scheduled',
          body: `Visit scheduled for ${event.customerName || 'Customer'} at ${event.address}.`,
          type: NotificationType.VISIT_SCHEDULED,
          priority: NotificationPriority.NORMAL,
          entityType: 'VISIT',
          entityId: event.visitId,
          leadId: event.leadId,
          deepLink: links.deepLink,
          webLink: links.webLink,
          idempotencyKey: `visit:scheduled:mgr:${event.visitId}`,
        });
      }
    } catch (err: any) {
      logger.error(`Error in visit.scheduled notification handler: ${err.message}`);
    }
  });

  // 6. BOOKING EVENTS
  notificationEmitter.on('booking.created', async (event: {
    bookingId: string;
    leadId: string;
    executiveId: string;
    managerId?: string | null;
    bookingNumber: string;
    amount: number;
    customerName?: string;
  }) => {
    try {
      const links = buildNotificationLinks({ bookingId: event.bookingId, entityType: 'BOOKING', entityId: event.bookingId });

      // Notify Executive
      await NotificationsService.sendToUser(event.executiveId, {
        title: 'Booking Created Successfully',
        body: `Booking ${event.bookingNumber} for ₹${event.amount.toLocaleString('en-IN')} has been recorded.`,
        type: NotificationType.BOOKING_CREATED,
        priority: NotificationPriority.HIGH,
        entityType: 'BOOKING',
        entityId: event.bookingId,
        leadId: event.leadId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        idempotencyKey: `booking:created:${event.bookingId}`,
      });

      // Notify Manager
      if (event.managerId) {
        await NotificationsService.sendToUser(event.managerId, {
          title: 'New Unit Booking Created',
          body: `New booking ${event.bookingNumber} (₹${event.amount.toLocaleString('en-IN')}) for ${event.customerName || 'Customer'}.`,
          type: NotificationType.BOOKING_CREATED,
          priority: NotificationPriority.HIGH,
          entityType: 'BOOKING',
          entityId: event.bookingId,
          leadId: event.leadId,
          deepLink: links.deepLink,
          webLink: links.webLink,
          idempotencyKey: `booking:created:mgr:${event.bookingId}`,
        });
      }

      // Notify Admins
      await NotificationsService.sendToRole(Role.ADMIN, {
        title: 'New Booking Recorded',
        body: `Booking ${event.bookingNumber} recorded for ₹${event.amount.toLocaleString('en-IN')}.`,
        type: NotificationType.BOOKING_CREATED,
        priority: NotificationPriority.HIGH,
        entityType: 'BOOKING',
        entityId: event.bookingId,
        leadId: event.leadId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        idempotencyKey: `booking:created:adm:${event.bookingId}`,
      });
    } catch (err: any) {
      logger.error(`Error in booking.created notification handler: ${err.message}`);
    }
  });

  // 7. PAYMENT EVENTS
  notificationEmitter.on('payment.received', async (event: {
    paymentId: string;
    bookingId?: string;
    invoiceId?: string;
    amount: number;
    method: string;
    referenceNumber?: string | null;
  }) => {
    try {
      const links = buildNotificationLinks({ bookingId: event.bookingId, invoiceId: event.invoiceId, entityType: 'PAYMENT' });
      // Notify Admin and Managers
      await NotificationsService.sendToRole(Role.ADMIN, {
        title: 'Payment Received',
        body: `Payment of ₹${event.amount.toLocaleString('en-IN')} received via ${event.method}.${event.referenceNumber ? ` Ref: ${event.referenceNumber}` : ''}`,
        type: NotificationType.PAYMENT_RECEIVED,
        priority: NotificationPriority.HIGH,
        entityType: 'PAYMENT',
        entityId: event.paymentId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        idempotencyKey: `payment:received:${event.paymentId}`,
      });
    } catch (err: any) {
      logger.error(`Error in payment.received notification handler: ${err.message}`);
    }
  });

  // 8. META LEAD RECEIVED
  notificationEmitter.on('meta.lead.received', async (event: {
    leadId: string;
    metaLeadId: string;
    leadNumber: string;
    customerName: string;
    phone: string;
    campaignName?: string | null;
    managerId?: string | null;
    executiveId?: string | null;
  }) => {
    try {
      const links = buildNotificationLinks({ leadId: event.leadId, entityType: 'LEAD', entityId: event.leadId });

      // Notify Admins
      await NotificationsService.sendToRole(Role.ADMIN, {
        title: 'New Meta Lead Received',
        body: `${event.customerName} (${event.phone}) from ${event.campaignName || 'Facebook / Instagram Ad'}`,
        type: NotificationType.META_LEAD_RECEIVED,
        priority: NotificationPriority.NORMAL,
        entityType: 'LEAD',
        entityId: event.leadId,
        leadId: event.leadId,
        deepLink: links.deepLink,
        webLink: links.webLink,
        idempotencyKey: `meta:received:adm:${event.metaLeadId}`,
        metadata: event,
      });

      // Notify Manager
      if (event.managerId) {
        await NotificationsService.sendToUser(event.managerId, {
          title: 'New Meta Lead Assigned to Team',
          body: `${event.customerName} (${event.phone}) from ${event.campaignName || 'Meta Campaign'}`,
          type: NotificationType.META_LEAD_RECEIVED,
          priority: NotificationPriority.NORMAL,
          entityType: 'LEAD',
          entityId: event.leadId,
          leadId: event.leadId,
          deepLink: links.deepLink,
          webLink: links.webLink,
          idempotencyKey: `meta:received:mgr:${event.metaLeadId}`,
          metadata: event,
        });
      }

      // If auto-assigned to executive
      if (event.executiveId) {
        await NotificationsService.sendToUser(event.executiveId, {
          title: 'New Meta Lead Assigned',
          body: `Lead ${event.leadNumber}: ${event.customerName} assigned to you.`,
          type: NotificationType.LEAD_ASSIGNED,
          priority: NotificationPriority.HIGH,
          entityType: 'LEAD',
          entityId: event.leadId,
          leadId: event.leadId,
          deepLink: links.deepLink,
          webLink: links.webLink,
          idempotencyKey: `meta:assigned:exec:${event.metaLeadId}`,
          metadata: event,
        });
      }
    } catch (err: any) {
      logger.error(`Error in meta.lead.received notification handler: ${err.message}`);
    }
  });

  logger.info('Registered all CRM Notification event listeners.');
};
