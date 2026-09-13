import { NotificationPriority, Role } from '@prisma/client';

export enum NotificationType {
  // Leads
  LEAD_ASSIGNED = 'LEAD_ASSIGNED',
  LEAD_REASSIGNED = 'LEAD_REASSIGNED',
  LEAD_UNASSIGNED = 'LEAD_UNASSIGNED',
  LEAD_STATUS_CHANGED = 'LEAD_STATUS_CHANGED',
  LEAD_CREATED = 'LEAD_CREATED',
  LEAD_UPDATED = 'LEAD_UPDATED',
  LEAD_DUPLICATE_DETECTED = 'LEAD_DUPLICATE_DETECTED',

  // Callbacks
  CALLBACK_CREATED = 'CALLBACK_CREATED',
  CALLBACK_DUE = 'CALLBACK_DUE',
  CALLBACK_OVERDUE = 'CALLBACK_OVERDUE',

  // Follow-ups
  FOLLOW_UP_CREATED = 'FOLLOW_UP_CREATED',
  FOLLOW_UP_DUE = 'FOLLOW_UP_DUE',
  FOLLOW_UP_OVERDUE = 'FOLLOW_UP_OVERDUE',

  // Visits
  VISIT_SCHEDULED = 'VISIT_SCHEDULED',
  VISIT_REMINDER = 'VISIT_REMINDER',
  VISIT_STARTED = 'VISIT_STARTED',
  VISIT_COMPLETED = 'VISIT_COMPLETED',
  VISIT_MISSED = 'VISIT_MISSED',

  // Revisits
  REVISIT_SCHEDULED = 'REVISIT_SCHEDULED',
  REVISIT_REMINDER = 'REVISIT_REMINDER',
  REVISIT_COMPLETED = 'REVISIT_COMPLETED',
  REVISIT_MISSED = 'REVISIT_MISSED',

  // Calls
  CALL_STARTED = 'CALL_STARTED',
  CALL_COMPLETED = 'CALL_COMPLETED',
  CALL_MISSED = 'CALL_MISSED',
  CALL_RECORDING_AVAILABLE = 'CALL_RECORDING_AVAILABLE',
  CALL_OUTCOME_UPDATED = 'CALL_OUTCOME_UPDATED',

  // Bookings
  BOOKING_CREATED = 'BOOKING_CREATED',
  BOOKING_UPDATED = 'BOOKING_UPDATED',
  BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',

  // Payments & Invoices
  PAYMENT_CREATED = 'PAYMENT_CREATED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  INVOICE_CREATED = 'INVOICE_CREATED',
  INVOICE_UPDATED = 'INVOICE_UPDATED',
  INVOICE_OVERDUE = 'INVOICE_OVERDUE',

  // Team & Activity
  TEAM_ACTIVITY = 'TEAM_ACTIVITY',
  EXECUTIVE_INACTIVE = 'EXECUTIVE_INACTIVE',

  // Meta Integration
  META_LEAD_RECEIVED = 'META_LEAD_RECEIVED',
  META_LEAD_SYNC_FAILED = 'META_LEAD_SYNC_FAILED',
  META_LEAD_SYNC_COMPLETED = 'META_LEAD_SYNC_COMPLETED',

  // System Alerts
  SYSTEM_ALERT = 'SYSTEM_ALERT',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  SECURITY_ALERT = 'SECURITY_ALERT',

  // Summaries
  DAILY_SUMMARY = 'DAILY_SUMMARY',
  WEEKLY_SUMMARY = 'WEEKLY_SUMMARY',
}

export interface NotificationPayload {
  title: string;
  body: string;
  type: NotificationType | string;
  priority?: NotificationPriority;
  entityType?: string;
  entityId?: string;
  leadId?: string;
  customerId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
  deepLink?: string;
  webLink?: string;
}

export interface NotificationPreferencesInput {
  leadAssignment?: boolean;
  leadStatus?: boolean;
  callback?: boolean;
  followUp?: boolean;
  visit?: boolean;
  revisit?: boolean;
  call?: boolean;
  booking?: boolean;
  payment?: boolean;
  teamUpdates?: boolean;
  dailySummary?: boolean;
  systemAlerts?: boolean;
  inApp?: boolean;
  push?: boolean;
  email?: boolean;
}

/**
 * Generate standard mobile and web deep links based on entity type and IDs
 */
export const buildNotificationLinks = (params: {
  entityType?: string;
  entityId?: string;
  leadId?: string;
  bookingId?: string;
  invoiceId?: string;
}) => {
  const { entityType, entityId, leadId, bookingId, invoiceId } = params;

  let deepLink = 'crm://notifications';
  let webLink = '/admin/notifications';

  if (leadId) {
    deepLink = `crm://lead/${leadId}`;
    webLink = `/admin/leads`;
  } else if (bookingId || (entityType === 'BOOKING' && entityId)) {
    const bId = bookingId || entityId;
    deepLink = `crm://booking/${bId}`;
    webLink = `/admin/bookings`;
  } else if (invoiceId || (entityType === 'INVOICE' && entityId)) {
    const invId = invoiceId || entityId;
    deepLink = `crm://invoice/${invId}`;
    webLink = `/admin/billing`;
  }

  return { deepLink, webLink };
};
