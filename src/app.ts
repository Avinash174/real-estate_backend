import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/index.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sendSuccess } from './utils/response.js';

// Import Route Handlers
import authRoutes, { adminAuthRouter, mobileAuthRouter } from './modules/auth/auth.routes.js';
import { NotificationsController } from './modules/notifications/notifications.controller.js';
import { authenticate } from './middleware/authenticate.js';
import usersRoutes from './modules/users/users.routes.js';
import leadsRoutes from './modules/leads/leads.routes.js';
import assignmentsRoutes from './modules/assignments/assignments.routes.js';
import callsRoutes from './modules/calls/calls.routes.js';
import callbacksRoutes from './modules/callbacks/callbacks.routes.js';
import followUpsRoutes from './modules/followups/followups.routes.js';
import visitsRoutes from './modules/visits/visits.routes.js';
import bookingsRoutes from './modules/bookings/bookings.routes.js';
import billingRoutes from './modules/billing/billing.routes.js';
import trackingRoutes from './modules/tracking/tracking.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';
import notificationsRoutes from './modules/notifications/notifications.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import { metaWebhookRouter, metaAdminRouter, metaLeadsRouter } from './modules/integrations/meta/meta.routes.js';
import apiIntegrationsRoutes from './modules/integrations/integrations.routes.js';

export const createApp = (): Express => {
  const app = express();

  // Standard Security & Parsing Middlewares
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(','),
      credentials: true,
    })
  );
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  if (config.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }

  app.use(apiRateLimiter);

  // Health Check Endpoint
  app.get('/api/health', (req, res) => {
    sendSuccess(res, { status: 'UP', timestamp: new Date() }, 'Real Estate CRM API is operating normally');
  });

  // API v1 Central Endpoints
  const v1 = express.Router();
  v1.get('/health', (req, res) => {
    sendSuccess(res, { status: 'UP', timestamp: new Date() }, 'Real Estate CRM API is operating normally');
  });
  v1.use('/admin/auth', adminAuthRouter);
  v1.use('/mobile/auth', mobileAuthRouter);
  v1.use('/auth', authRoutes);
  v1.use('/users', usersRoutes);
  v1.use('/leads', leadsRoutes);
  v1.use('/assignments', assignmentsRoutes);
  v1.use('/calls', callsRoutes);
  v1.use('/callbacks', callbacksRoutes);
  v1.use('/followups', followUpsRoutes);
  v1.use('/visits', visitsRoutes);
  v1.use('/bookings', bookingsRoutes);
  v1.use('/billing', billingRoutes);
  v1.use('/tracking', trackingRoutes);
  v1.use('/reports', reportsRoutes);
  v1.use('/notifications', notificationsRoutes);
  v1.use('/audit', auditRoutes);
  v1.use('/settings', settingsRoutes);

  // Meta Lead Ads Integration Endpoints (must be registered before generic /admin/integrations/:provider)
  v1.use('/integrations/meta', metaWebhookRouter);
  v1.use('/admin/integrations/meta', metaAdminRouter);
  v1.use('/admin/leads/meta', metaLeadsRouter);

  // API Integrations (Admin Only)
  v1.use('/admin/integrations', apiIntegrationsRoutes);
  v1.use('/settings/integrations', apiIntegrationsRoutes);
  v1.use('/settings/api-integrations', apiIntegrationsRoutes);

  // Specification Route Aliases for Admin, Manager, Mobile
  v1.use('/admin/users', usersRoutes);
  v1.use('/admin/leads', leadsRoutes);
  v1.use('/admin/reports', reportsRoutes);
  v1.use('/admin/tracking', trackingRoutes);
  v1.use('/admin/billing', billingRoutes);
  v1.use('/admin/visits', visitsRoutes);
  v1.use('/admin/calls', callsRoutes);
  v1.use('/admin/callbacks', callbacksRoutes);
  v1.use('/admin/followups', followUpsRoutes);
  v1.use('/admin/bookings', bookingsRoutes);
  v1.use('/admin/audit', auditRoutes);
  v1.use('/admin/assignments', assignmentsRoutes);
  v1.use('/admin/settings', settingsRoutes);
  v1.use('/admin/notifications', notificationsRoutes);

  v1.use('/manager/team', usersRoutes);
  v1.use('/manager/leads', leadsRoutes);
  v1.use('/manager/reports', reportsRoutes);
  v1.use('/manager/tracking', trackingRoutes);

  v1.use('/mobile/leads', leadsRoutes);
  v1.use('/mobile/calls', callsRoutes);
  v1.use('/mobile/visits', visitsRoutes);
  v1.use('/mobile/location', trackingRoutes);
  v1.use('/mobile/notifications', notificationsRoutes);
  v1.post('/mobile/devices', authenticate, NotificationsController.registerDevice);
  v1.delete('/mobile/devices/:fcmToken', authenticate, NotificationsController.unregisterDevice);

  app.use('/api/v1', v1);

  // 404 Route Catch-All
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      errorCode: 'ROUTE_NOT_FOUND',
    });
  });

  // Central Error Handler
  app.use(errorHandler);

  return app;
};
