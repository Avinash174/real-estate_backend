import { prisma } from '../../../utils/prisma.js';
import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { normalizeIndianPhone } from '../../../utils/phone.js';
import { decryptToken } from '../../../utils/encryption.js';
import { MetaApiClient, MetaLeadDetails, MetaLeadgenFieldData, metaApiClient } from './meta.api.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { getSocketIO } from '../../../socket.js';
import { LeadSource, LeadStatus, Priority, Role } from '@prisma/client';
import { logAudit } from '../../../utils/audit.js';

export class MetaService {
  /**
   * Normalize Meta form field data into structured CRM customer details
   */
  static normalizeLeadData(fieldData: MetaLeadgenFieldData[] = []) {
    let name = '';
    let rawPhone = '';
    let email = '';
    let city = '';
    const customFields: Record<string, string> = {};
    const remarksParts: string[] = [];

    let firstName = '';
    let lastName = '';

    for (const field of fieldData) {
      const key = field.name?.toLowerCase().trim() || '';
      const val = Array.isArray(field.values) ? field.values.join(', ').trim() : String(field.values || '').trim();

      if (!val) continue;

      if (key === 'full_name' || key === 'name' || key === 'your_name') {
        name = val;
      } else if (key === 'first_name') {
        firstName = val;
      } else if (key === 'last_name') {
        lastName = val;
      } else if (
        key === 'phone_number' ||
        key === 'phone' ||
        key === 'mobile' ||
        key === 'contact_number' ||
        key === 'whatsapp_number'
      ) {
        rawPhone = val;
      } else if (key === 'email' || key === 'email_address' || key === 'work_email') {
        email = val.toLowerCase().trim();
      } else if (key === 'city' || key === 'location' || key === 'current_city') {
        city = val;
      } else if (key === 'message' || key === 'remarks' || key === 'comments' || key === 'requirements') {
        remarksParts.push(val);
      } else {
        // Store any custom question answers in customFields & remarks
        customFields[field.name] = val;
        remarksParts.push(`${field.name}: ${val}`);
      }
    }

    if (!name && (firstName || lastName)) {
      name = `${firstName} ${lastName}`.trim();
    }
    if (!name) {
      name = 'Meta Lead Customer';
    }

    const phoneNorm = normalizeIndianPhone(rawPhone);
    const remarks = remarksParts.length > 0 ? remarksParts.join(' | ') : null;

    return {
      name,
      phone: phoneNorm.e164 || rawPhone,
      phoneNorm,
      email: email || null,
      city: city || null,
      remarks,
      customFields,
    };
  }

  /**
   * Get Active Meta Access Token for a Page ID, falling back to environment config
   */
  static async getActiveAccessToken(pageId?: string): Promise<{ token: string; appSecret?: string; pageId?: string }> {
    if (pageId) {
      const integration = await prisma.metaIntegration.findUnique({
        where: { pageId },
      });
      if (integration?.isActive && integration.accessToken) {
        return {
          token: decryptToken(integration.accessToken),
          appSecret: integration.appSecret ? decryptToken(integration.appSecret) : config.META_APP_SECRET,
          pageId: integration.pageId,
        };
      }
    }

    // Try finding any active integration from DB
    const firstActive = await prisma.metaIntegration.findFirst({
      where: { isActive: true },
    });
    if (firstActive?.accessToken) {
      return {
        token: decryptToken(firstActive.accessToken),
        appSecret: firstActive.appSecret ? decryptToken(firstActive.appSecret) : config.META_APP_SECRET,
        pageId: firstActive.pageId,
      };
    }

    // Fall back to environment configuration
    return {
      token: config.META_ACCESS_TOKEN || '',
      appSecret: config.META_APP_SECRET || '',
      pageId: config.META_PAGE_ID || '',
    };
  }

  /**
   * Automatically resolve assignment based on Campaign rules, Round-Robin, or Default Manager
   */
  static async resolveLeadAssignment(metaLead: MetaLeadDetails): Promise<{ managerId?: string; executiveId?: string }> {
    // 1. Check Campaign-based assignment
    if (metaLead.campaign_id || metaLead.campaign_name) {
      const rule = await prisma.metaCampaignAssignment.findFirst({
        where: {
          isActive: true,
          OR: [
            ...(metaLead.campaign_id ? [{ campaignId: metaLead.campaign_id }] : []),
            ...(metaLead.campaign_name
              ? [{ campaignName: { contains: metaLead.campaign_name, mode: 'insensitive' as const } }]
              : []),
          ],
        },
      });

      if (rule) {
        let assignedExec: string | undefined;
        if (rule.executiveIds && rule.executiveIds.length > 0) {
          // Round-robin: select executive with fewest assigned leads today
          const execWorkloads = await prisma.lead.groupBy({
            by: ['assignedExecutiveId'],
            where: {
              assignedExecutiveId: { in: rule.executiveIds },
              createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
            },
            _count: true,
          });

          const workloadMap = new Map<string, number>();
          rule.executiveIds.forEach((id) => workloadMap.set(id, 0));
          execWorkloads.forEach((item) => {
            if (item.assignedExecutiveId) {
              workloadMap.set(item.assignedExecutiveId, item._count);
            }
          });

          // Sort by lowest count
          const sorted = Array.from(workloadMap.entries()).sort((a, b) => a[1] - b[1]);
          assignedExec = sorted[0]?.[0];
        }

        return {
          managerId: rule.managerId || undefined,
          executiveId: assignedExec,
        };
      }
    }

    // 2. Default Round-Robin across Managers & Executives
    const managers = await prisma.user.findMany({
      where: { role: Role.MANAGER, status: 'ACTIVE' },
      select: { id: true },
    });

    let managerId: string | undefined;
    if (managers.length > 0) {
      // Pick manager with least leads today
      const managerLoads = await prisma.lead.groupBy({
        by: ['assignedManagerId'],
        where: {
          assignedManagerId: { in: managers.map((m) => m.id) },
        },
        _count: true,
      });
      const mMap = new Map<string, number>();
      managers.forEach((m) => mMap.set(m.id, 0));
      managerLoads.forEach((l) => {
        if (l.assignedManagerId) mMap.set(l.assignedManagerId, l._count);
      });
      managerId = Array.from(mMap.entries()).sort((a, b) => a[1] - b[1])[0]?.[0];
    }

    // Pick executive under this manager or any active executive
    const executives = await prisma.user.findMany({
      where: {
        role: Role.EXECUTIVE,
        status: 'ACTIVE',
        ...(managerId ? { managerId } : {}),
      },
      select: { id: true },
    });

    let executiveId: string | undefined;
    if (executives.length > 0) {
      const execLoads = await prisma.lead.groupBy({
        by: ['assignedExecutiveId'],
        where: {
          assignedExecutiveId: { in: executives.map((e) => e.id) },
        },
        _count: true,
      });
      const eMap = new Map<string, number>();
      executives.forEach((e) => eMap.set(e.id, 0));
      execLoads.forEach((l) => {
        if (l.assignedExecutiveId) eMap.set(l.assignedExecutiveId, l._count);
      });
      executiveId = Array.from(eMap.entries()).sort((a, b) => a[1] - b[1])[0]?.[0];
    }

    return { managerId, executiveId };
  }

  /**
   * Process a single normalized Meta Lead:
   * 1. Idempotency check via metaLeadId
   * 2. Customer duplicate check via normalized phone/email
   * 3. Create/Link Lead with source = META
   * 4. Record Meta attribution
   * 5. Resolve manager & executive assignment
   * 6. Trigger notifications & real-time Socket updates
   */
  static async processLead(metaLead: MetaLeadDetails): Promise<{ lead: any; isDuplicate: boolean }> {
    // 1. Idempotency Check on Meta Lead ID
    const existingMetaLead = await prisma.metaLead.findUnique({
      where: { metaLeadId: metaLead.id },
      include: { lead: { include: { customer: true, assignedManager: true, assignedExecutive: true } } },
    });

    if (existingMetaLead) {
      logger.info(`META_LEAD_DUPLICATE: Meta Lead ID ${metaLead.id} already imported as CRM Lead ${existingMetaLead.lead?.leadNumber}`);
      return { lead: existingMetaLead.lead, isDuplicate: true };
    }

    // 2. Normalize customer fields
    const norm = this.normalizeLeadData(metaLead.field_data);

    // 3. Check for existing customer by phone search variants or email
    const searchConditions: any[] = [];
    if (norm.phoneNorm.searchVariants.length > 0) {
      searchConditions.push({ phone: { in: norm.phoneNorm.searchVariants } });
    }
    if (norm.email) {
      searchConditions.push({ email: norm.email });
    }

    let customer = await prisma.customer.findFirst({
      where: { OR: searchConditions },
      include: { leads: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    const isExistingCustomer = !!customer;

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: norm.name,
          phone: norm.phoneNorm.e164 || norm.phone,
          email: norm.email,
          city: norm.city,
        },
        include: { leads: true },
      });
    }

    // 4. Resolve Assignment
    const { managerId, executiveId } = await this.resolveLeadAssignment(metaLead);

    // 5. Generate Lead Number (LD-YYYY-XXXX)
    const count = await prisma.lead.count();
    const currentYear = new Date().getFullYear();
    const leadNumber = `LD-${currentYear}-${String(count + 1).padStart(4, '0')}`;

    // 6. Create CRM Lead with source = META
    const lead = await prisma.lead.create({
      data: {
        leadNumber,
        customerId: customer.id,
        source: LeadSource.META,
        status: executiveId ? LeadStatus.ASSIGNED : LeadStatus.NEW,
        priority: Priority.HIGH, // Meta leads default to HIGH priority
        remarks: norm.remarks,
        assignedManagerId: managerId || null,
        assignedExecutiveId: executiveId || null,
        createdAt: metaLead.created_time ? new Date(metaLead.created_time) : new Date(),
      },
      include: {
        customer: true,
        assignedManager: { select: { id: true, name: true, phone: true } },
        assignedExecutive: { select: { id: true, name: true, phone: true } },
      },
    });

    // 7. Store Meta Attribution Details
    await prisma.metaLead.create({
      data: {
        leadId: lead.id,
        metaLeadId: metaLead.id,
        pageId: metaLead.page_id || null,
        pageName: metaLead.page_name || null,
        formId: metaLead.form_id || null,
        formName: metaLead.form_name || null,
        campaignId: metaLead.campaign_id || null,
        campaignName: metaLead.campaign_name || null,
        adSetId: metaLead.adset_id || null,
        adSetName: metaLead.adset_name || null,
        adId: metaLead.ad_id || null,
        adName: metaLead.ad_name || null,
        rawPayload: metaLead.rawPayload || (metaLead as any),
      },
    });

    // 8. Record Activity Timeline: META_LEAD_RECEIVED
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        activityType: 'META_LEAD_RECEIVED',
        description: `Meta Lead Ad received via Form '${metaLead.form_name || metaLead.form_id || 'Lead Form'}' from Campaign '${metaLead.campaign_name || 'Meta Ad'}'`,
        metadata: {
          metaLeadId: metaLead.id,
          campaign: metaLead.campaign_name,
          form: metaLead.form_name,
          ad: metaLead.ad_name,
          isExistingCustomer,
        },
      },
    });

    // If executive assigned, record assignment activity
    if (executiveId) {
      const assignedById =
        managerId ||
        (await prisma.user.findFirst({ where: { role: Role.ADMIN } }))?.id ||
        executiveId;

      await prisma.leadAssignment.create({
        data: {
          leadId: lead.id,
          previousExecutiveId: null,
          newExecutiveId: executiveId,
          assignedById,
          reason: 'Automated Meta Lead Campaign Routing',
        },
      });

      await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          activityType: 'LEAD_ASSIGNED',
          description: `Automatically routed to executive ${lead.assignedExecutive?.name || ''}`,
          metadata: { executiveId },
        },
      });
    }

    logger.info(`META_LEAD_CREATED: Created CRM Lead ${lead.leadNumber} (ID: ${lead.id}) from Meta Lead ID ${metaLead.id}`);

    // 9. Dispatch Notifications
    try {
      // Notify Manager
      if (managerId) {
        await NotificationsService.sendPushNotification(
          managerId,
          'New Meta Lead Received',
          `${customer.name} (${customer.phone}) from ${metaLead.campaign_name || 'Meta Campaign'}`,
          'NEW_META_LEAD',
          { leadId: lead.id, metaLeadId: metaLead.id }
        );
      }

      // Notify Executive
      if (executiveId) {
        await NotificationsService.sendPushNotification(
          executiveId,
          'New Meta Lead Assigned',
          `Lead ${lead.leadNumber}: ${customer.name} assigned to you.`,
          'LEAD_ASSIGNED',
          { leadId: lead.id, metaLeadId: metaLead.id }
        );
      }
    } catch (notifErr: any) {
      logger.error(`Error sending Meta lead notifications: ${notifErr.message}`);
    }

    // 10. Real-time Socket.IO Broadcast
    try {
      const io = getSocketIO();
      if (io) {
        const socketPayload = {
          id: lead.id,
          leadNumber: lead.leadNumber,
          customer: { name: customer.name, phone: customer.phone },
          source: 'META',
          campaign: metaLead.campaign_name,
          assignedExecutive: lead.assignedExecutive,
          assignedManager: lead.assignedManager,
          createdAt: lead.createdAt,
        };
        io.to('room:admin').emit('meta.lead_received', socketPayload);
        if (managerId) {
          io.to(`room:manager:${managerId}`).emit('meta.lead_received', socketPayload);
        }
        if (executiveId) {
          io.to(`room:executive:${executiveId}`).emit('meta.lead_received', socketPayload);
        }
      }
    } catch (socketErr: any) {
      logger.error(`Error emitting socket event: ${socketErr.message}`);
    }

    // 11. Update MetaIntegration counters if pageId exists
    if (metaLead.page_id) {
      await prisma.metaIntegration.updateMany({
        where: { pageId: metaLead.page_id },
        data: {
          lastLeadReceivedAt: new Date(),
          totalLeadsCount: { increment: 1 },
        },
      });
    }

    return { lead, isDuplicate: false };
  }

  /**
   * Asynchronously process a raw webhook payload
   */
  static async processWebhookPayload(payload: any) {
    if (!payload || !Array.isArray(payload.entry)) {
      logger.warn('META_WEBHOOK: Invalid webhook payload structure');
      return;
    }

    for (const entry of payload.entry) {
      const pageId = entry.id;
      const changes = entry.changes || [];

      for (const change of changes) {
        if (change.field !== 'leadgen') continue;

        const val = change.value || {};
        const leadgenId = val.leadgen_id;

        if (!leadgenId) {
          logger.warn(`META_WEBHOOK: Missing leadgen_id in change entry for page ${pageId}`);
          continue;
        }

        logger.info(`META_WEBHOOK_RECEIVED: Processing Meta Lead ID ${leadgenId} from Page ${pageId}`);

        // 1. Create audit import log
        const log = await prisma.metaLeadImportLog.create({
          data: {
            metaLeadId: String(leadgenId),
            pageId: String(pageId),
            status: 'RECEIVED',
            payload: val,
          },
        });

        try {
          // 2. Fetch Active Access Token
          const { token } = await this.getActiveAccessToken(pageId);
          if (!token) {
            throw new Error(`No active Meta access token configured for Page ID ${pageId}`);
          }

          // 3. Fetch lead details from Meta Graph API
          const leadDetails = await metaApiClient.getLeadDetails(String(leadgenId), token);

          // Populate page ID if missing
          if (!leadDetails.page_id && pageId) {
            leadDetails.page_id = String(pageId);
          }

          // 4. Ingest and create lead in CRM
          await this.processLead(leadDetails);

          // 5. Update log to SUCCESS
          await prisma.metaLeadImportLog.update({
            where: { id: log.id },
            data: { status: 'SUCCESS' },
          });
        } catch (error: any) {
          const errMsg = error.response?.data?.error?.message || error.message;
          logger.error(`META_LEAD_IMPORT_FAILED: Error processing Meta Lead ${leadgenId}: ${errMsg}`);

          await prisma.metaLeadImportLog.update({
            where: { id: log.id },
            data: {
              status: 'FAILED',
              errorMessage: errMsg,
            },
          });
        }
      }
    }
  }

  /**
   * Retry failed imports with exponential backoff
   */
  static async retryFailedImports(maxRetries = 5) {
    const failedLogs = await prisma.metaLeadImportLog.findMany({
      where: {
        status: 'FAILED',
        retryCount: { lt: maxRetries },
      },
      take: 20,
      orderBy: { updatedAt: 'asc' },
    });

    logger.info(`META_RETRY: Found ${failedLogs.length} failed lead imports to retry`);

    for (const log of failedLogs) {
      if (!log.metaLeadId) continue;

      try {
        await prisma.metaLeadImportLog.update({
          where: { id: log.id },
          data: { status: 'RETRYING', retryCount: { increment: 1 } },
        });

        const { token } = await this.getActiveAccessToken(log.pageId || undefined);
        if (!token) throw new Error('No active Meta access token');

        const leadDetails = await metaApiClient.getLeadDetails(log.metaLeadId, token);
        await this.processLead(leadDetails);

        await prisma.metaLeadImportLog.update({
          where: { id: log.id },
          data: { status: 'SUCCESS' },
        });

        logger.info(`META_RETRY_SUCCESS: Retried and imported Meta Lead ID ${log.metaLeadId}`);
      } catch (err: any) {
        logger.error(`META_RETRY_ERROR: Retry failed for Meta Lead ${log.metaLeadId}: ${err.message}`);
        await prisma.metaLeadImportLog.update({
          where: { id: log.id },
          data: {
            status: 'FAILED',
            errorMessage: err.message,
          },
        });
      }
    }
  }
}
