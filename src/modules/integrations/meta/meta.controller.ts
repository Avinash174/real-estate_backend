import { Request, Response, NextFunction } from 'express';
import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { MetaApiClient, metaApiClient } from './meta.api.js';
import { MetaService } from './meta.service.js';
import { sendSuccess, sendError } from '../../../utils/response.js';
import { AuthenticatedRequest } from '../../../middleware/authenticate.js';
import { prisma } from '../../../utils/prisma.js';
import { encryptToken, maskToken } from '../../../utils/encryption.js';

export class MetaWebhookController {
  /**
   * GET /api/v1/integrations/meta/webhook
   * Meta Webhook Verification Endpoint
   */
  static async verifyWebhook(req: Request, res: Response) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const expectedToken = config.META_WEBHOOK_VERIFY_TOKEN || 'estatepulse_meta_verify_token';

    if (mode === 'subscribe' && token === expectedToken) {
      logger.info('META_WEBHOOK_VERIFICATION_SUCCESS: Meta webhook verified successfully');
      return res.status(200).send(challenge);
    }

    // Also check if any configured MetaIntegration has custom verifyToken
    if (mode === 'subscribe' && token) {
      const integration = await prisma.metaIntegration.findFirst({
        where: { verifyToken: token as string, isActive: true },
      });
      if (integration) {
        logger.info(`META_WEBHOOK_VERIFICATION_SUCCESS: Meta webhook verified via integration for Page ${integration.pageId}`);
        return res.status(200).send(challenge);
      }
    }

    logger.warn(`META_WEBHOOK_VERIFICATION_FAILED: Rejected webhook verification with invalid token: ${token}`);
    return res.status(403).send('Forbidden');
  }

  /**
   * POST /api/v1/integrations/meta/webhook
   * Meta Leadgen Webhook Receiver
   */
  static async receiveWebhook(req: Request, res: Response) {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    // Verify HMAC-SHA256 signature if secret configured
    if (config.META_APP_SECRET) {
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const isValid = MetaApiClient.verifyWebhookSignature(rawBody, signature, config.META_APP_SECRET);
      if (!isValid) {
        logger.warn('META_WEBHOOK_SIGNATURE_INVALID: Rejected webhook payload with invalid signature');
        return res.status(401).json({ success: false, message: 'Invalid signature' });
      }
    }

    // Acknowledge Meta immediately with 200 OK (avoids timeout & retries)
    res.status(200).json({ success: true, message: 'EVENT_RECEIVED' });

    // Process asynchronously in background
    setImmediate(() => {
      MetaService.processWebhookPayload(req.body).catch((err) => {
        logger.error(`Error in async webhook background processor: ${err.message}`);
      });
    });
  }
}

export class MetaAdminController {
  /**
   * GET /api/v1/admin/integrations/meta
   * Fetch current Meta connection status
   */
  static async getIntegrationStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const integration = await prisma.metaIntegration.findFirst({
        orderBy: { updatedAt: 'desc' },
      });

      const isConfigured = !!(integration?.accessToken || config.META_ACCESS_TOKEN);

      return sendSuccess(res, {
        isConfigured,
        isActive: integration ? integration.isActive : isConfigured,
        pageId: integration?.pageId || config.META_PAGE_ID || '',
        pageName: integration?.pageName || (isConfigured ? 'Connected Meta Page' : 'Not Connected'),
        maskedToken: maskToken(integration?.accessToken || config.META_ACCESS_TOKEN || ''),
        lastLeadReceivedAt: integration?.lastLeadReceivedAt || null,
        lastSyncAt: integration?.lastSyncAt || null,
        totalLeadsCount: integration?.totalLeadsCount || 0,
        webhookUrl: `${req.protocol}://${req.get('host')}/api/v1/integrations/meta/webhook`,
        verifyToken: config.META_WEBHOOK_VERIFY_TOKEN || 'estatepulse_meta_verify_token',
        graphApiVersion: config.META_GRAPH_API_VERSION || 'v21.0',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/integrations/meta/connect
   * Connect or update Meta Page integration
   */
  static async connectIntegration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { pageId, pageName, accessToken, appSecret, verifyToken } = req.body;

      if (!pageId || !accessToken) {
        return sendError(res, 'Page ID and Access Token are required', 'BAD_REQUEST', 400);
      }

      // Test token with Meta API before saving
      const test = await metaApiClient.testConnection(accessToken, pageId);
      if (!test.success) {
        return sendError(res, `Failed to verify Meta credentials: ${test.error}`, 'META_VERIFICATION_FAILED', 400);
      }

      const verifiedPageName = test.page?.name || pageName || 'Meta Business Page';

      const encryptedToken = encryptToken(accessToken);
      const encryptedSecret = appSecret ? encryptToken(appSecret) : undefined;

      const integration = await prisma.metaIntegration.upsert({
        where: { pageId },
        update: {
          pageName: verifiedPageName,
          accessToken: encryptedToken,
          ...(encryptedSecret && { appSecret: encryptedSecret }),
          ...(verifyToken && { verifyToken }),
          isActive: true,
        },
        create: {
          pageId,
          pageName: verifiedPageName,
          accessToken: encryptedToken,
          appSecret: encryptedSecret,
          verifyToken: verifyToken || config.META_WEBHOOK_VERIFY_TOKEN,
          isActive: true,
        },
      });

      return sendSuccess(res, {
        id: integration.id,
        pageId: integration.pageId,
        pageName: integration.pageName,
        isActive: integration.isActive,
        maskedToken: maskToken(integration.accessToken),
      }, 'Meta integration connected successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/integrations/meta/test
   * Test current active connection
   */
  static async testConnection(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { token, pageId } = await MetaService.getActiveAccessToken();
      if (!token) {
        return sendError(res, 'No active Meta access token configured', 'NOT_CONFIGURED', 400);
      }

      const test = await metaApiClient.testConnection(token, pageId);
      if (!test.success) {
        return sendError(res, `Unable to verify Meta integration: ${test.error}`, 'META_TEST_FAILED', 400);
      }

      return sendSuccess(res, {
        status: 'CONNECTED',
        page: test.page,
      }, 'Meta integration is working normally');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/integrations/meta/sync
   * Trigger manual sync/reconciliation
   */
  static async syncLeads(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { token, pageId } = await MetaService.getActiveAccessToken();
      if (!token || !pageId) {
        return sendError(res, 'Active Meta Page ID and Access Token are required for sync', 'BAD_REQUEST', 400);
      }

      const integration = await prisma.metaIntegration.findUnique({ where: { pageId } });
      const sinceDate = integration?.lastSyncAt || new Date(Date.now() - 48 * 60 * 60 * 1000); // last 48 hours

      const leads = await metaApiClient.getPageLeads(pageId, token, sinceDate);

      let imported = 0;
      let duplicates = 0;

      for (const metaLead of leads) {
        const result = await MetaService.processLead(metaLead);
        if (result.isDuplicate) {
          duplicates++;
        } else {
          imported++;
        }
      }

      await prisma.metaIntegration.updateMany({
        where: { pageId },
        data: { lastSyncAt: new Date() },
      });

      return sendSuccess(res, {
        totalFound: leads.length,
        imported,
        duplicates,
        lastSyncAt: new Date(),
      }, `Sync completed: ${imported} imported, ${duplicates} duplicates skipped.`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/integrations/meta/disconnect
   * Disconnect integration
   */
  static async disconnectIntegration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await prisma.metaIntegration.updateMany({
        data: { isActive: false },
      });
      return sendSuccess(res, { isConnected: false }, 'Meta integration disconnected');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/integrations/meta/reconciliation
   * Reconciliation summary between Meta and CRM counts
   */
  static async getReconciliation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const totalMetaLeadsInCrm = await prisma.metaLead.count();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayMetaLeads = await prisma.metaLead.count({
        where: { createdAt: { gte: today } },
      });

      const integration = await prisma.metaIntegration.findFirst({
        where: { isActive: true },
      });

      const campaignBreakdown = await prisma.metaLead.groupBy({
        by: ['campaignName'],
        _count: true,
      });

      return sendSuccess(res, {
        crmCount: totalMetaLeadsInCrm,
        todayCount: todayMetaLeads,
        metaReportedCount: integration?.totalLeadsCount || totalMetaLeadsInCrm,
        difference: Math.abs((integration?.totalLeadsCount || totalMetaLeadsInCrm) - totalMetaLeadsInCrm),
        campaignBreakdown: campaignBreakdown.map((c) => ({
          campaign: c.campaignName || 'Unattributed Campaign',
          count: c._count,
        })),
        lastSyncAt: integration?.lastSyncAt || null,
        status: 'IN_SYNC',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/leads/meta
   * List all Meta Leads with detailed attribution and filters
   */
  static async listMetaLeads(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        campaign,
        form,
        status,
        managerId,
        executiveId,
        datePreset,
      } = req.query as any;

      const pageNum = Math.max(Number(page) || 1, 1);
      const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      if (campaign) {
        where.campaignName = { contains: campaign, mode: 'insensitive' };
      }
      if (form) {
        where.formName = { contains: form, mode: 'insensitive' };
      }

      if (status) {
        where.lead = { ...where.lead, status };
      }
      if (managerId) {
        where.lead = { ...where.lead, assignedManagerId: managerId };
      }
      if (executiveId) {
        where.lead = { ...where.lead, assignedExecutiveId: executiveId };
      }

      if (search) {
        where.OR = [
          { metaLeadId: { contains: search, mode: 'insensitive' } },
          { campaignName: { contains: search, mode: 'insensitive' } },
          { lead: { customer: { name: { contains: search, mode: 'insensitive' } } } },
          { lead: { customer: { phone: { contains: search, mode: 'insensitive' } } } },
          { lead: { leadNumber: { contains: search, mode: 'insensitive' } } },
        ];
      }

      if (datePreset === 'today') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        where.createdAt = { gte: d };
      } else if (datePreset === 'thisWeek') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        where.createdAt = { gte: d };
      } else if (datePreset === 'thisMonth') {
        const d = new Date();
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        where.createdAt = { gte: d };
      }

      const [total, metaLeads] = await Promise.all([
        prisma.metaLead.count({ where }),
        prisma.metaLead.findMany({
          where,
          skip,
          take: limitNum,
          include: {
            lead: {
              include: {
                customer: true,
                assignedManager: { select: { id: true, name: true, employeeId: true } },
                assignedExecutive: { select: { id: true, name: true, employeeId: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      // Calculate Top KPIs
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - 7);

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const [totalAll, todayCount, weekCount, monthCount] = await Promise.all([
        prisma.metaLead.count(),
        prisma.metaLead.count({ where: { createdAt: { gte: startOfToday } } }),
        prisma.metaLead.count({ where: { createdAt: { gte: startOfWeek } } }),
        prisma.metaLead.count({ where: { createdAt: { gte: startOfMonth } } }),
      ]);

      return sendSuccess(
        res,
        {
          kpis: {
            total: totalAll,
            today: todayCount,
            thisWeek: weekCount,
            thisMonth: monthCount,
          },
          leads: metaLeads,
        },
        'Meta leads fetched successfully',
        200,
        {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        }
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/leads/meta/:id
   * Get single Meta Lead details with raw payload and timeline
   */
  static async getMetaLeadDetail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const metaLead = await prisma.metaLead.findFirst({
        where: {
          OR: [{ id }, { metaLeadId: id }, { leadId: id }],
        },
        include: {
          lead: {
            include: {
              customer: true,
              assignedManager: true,
              assignedExecutive: true,
              activities: { orderBy: { createdAt: 'desc' }, take: 15 },
              calls: { orderBy: { createdAt: 'desc' }, take: 5 },
              visits: { orderBy: { createdAt: 'desc' }, take: 5 },
              followUps: { orderBy: { createdAt: 'desc' }, take: 5 },
            },
          },
        },
      });

      if (!metaLead) {
        return sendError(res, 'Meta lead record not found', 'NOT_FOUND', 404);
      }

      return sendSuccess(res, metaLead, 'Meta lead details retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/integrations/meta/campaign-assignments
   * List campaign routing rules
   */
  static async listCampaignAssignments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const rules = await prisma.metaCampaignAssignment.findMany({
        include: { manager: { select: { id: true, name: true, employeeId: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return sendSuccess(res, rules, 'Campaign assignments fetched');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/integrations/meta/campaign-assignments
   * Create campaign routing rule
   */
  static async createCampaignAssignment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { campaignId, campaignName, managerId, executiveIds } = req.body;
      const rule = await prisma.metaCampaignAssignment.create({
        data: {
          campaignId: campaignId || null,
          campaignName: campaignName || null,
          managerId: managerId || null,
          executiveIds: Array.isArray(executiveIds) ? executiveIds : [],
        },
        include: { manager: { select: { id: true, name: true, employeeId: true } } },
      });
      return sendSuccess(res, rule, 'Campaign assignment created', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/admin/integrations/meta/campaign-assignments/:id
   */
  static async deleteCampaignAssignment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await prisma.metaCampaignAssignment.delete({ where: { id: req.params.id } });
      return sendSuccess(res, null, 'Campaign assignment deleted');
    } catch (error) {
      next(error);
    }
  }
}
