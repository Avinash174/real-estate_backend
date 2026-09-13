import { Router } from 'express';
import { MetaWebhookController, MetaAdminController } from './meta.controller.js';
import { authenticate } from '../../../middleware/authenticate.js';
import { authorize } from '../../../middleware/authorize.js';
import { Role } from '@prisma/client';

export const metaWebhookRouter = Router();

// Public Webhook Endpoints for Meta Cloud Platform
metaWebhookRouter.get('/webhook', MetaWebhookController.verifyWebhook);
metaWebhookRouter.post('/webhook', MetaWebhookController.receiveWebhook);

export const metaAdminRouter = Router();

// Protected Admin/Manager Integration & Reconciliation Endpoints
metaAdminRouter.use(authenticate);

metaAdminRouter.get('/', MetaAdminController.getIntegrationStatus);
metaAdminRouter.post('/connect', authorize([Role.ADMIN]), MetaAdminController.connectIntegration);
metaAdminRouter.post('/test', authorize([Role.ADMIN]), MetaAdminController.testConnection);
metaAdminRouter.post('/sync', authorize([Role.ADMIN]), MetaAdminController.syncLeads);
metaAdminRouter.post('/disconnect', authorize([Role.ADMIN]), MetaAdminController.disconnectIntegration);
metaAdminRouter.get('/reconciliation', MetaAdminController.getReconciliation);

// Campaign-based routing rules
metaAdminRouter.get('/campaign-assignments', MetaAdminController.listCampaignAssignments);
metaAdminRouter.post('/campaign-assignments', authorize([Role.ADMIN]), MetaAdminController.createCampaignAssignment);
metaAdminRouter.delete('/campaign-assignments/:id', authorize([Role.ADMIN]), MetaAdminController.deleteCampaignAssignment);

export const metaLeadsRouter = Router();

// Protected Meta Leads Reporting Endpoints
metaLeadsRouter.use(authenticate);
metaLeadsRouter.get('/', MetaAdminController.listMetaLeads);
metaLeadsRouter.get('/:id', MetaAdminController.getMetaLeadDetail);
