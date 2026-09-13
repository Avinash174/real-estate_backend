import { Response, NextFunction } from 'express';
import { IntegrationService } from './integrations.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';

export class IntegrationsController {
  static async listIntegrations(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const integrations = await IntegrationService.listMaskedIntegrations();
      return sendSuccess(res, integrations, 'API integrations retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getIntegration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { provider } = req.params;
      const integration = await IntegrationService.getMaskedIntegration(provider.toUpperCase());
      if (!integration) {
        return res.status(404).json({ success: false, message: 'Integration provider not found' });
      }
      return sendSuccess(res, integration, 'API integration retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async saveIntegration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { provider } = req.params;
      const saved = await IntegrationService.saveIntegration(
        provider.toUpperCase(),
        req.body,
        req.user!.userId
      );
      return sendSuccess(res, saved, 'API integration configuration saved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async testIntegration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { provider } = req.params;
      const testResult = await IntegrationService.testIntegration(
        provider.toUpperCase(),
        req.user!.userId
      );
      return sendSuccess(res, testResult, testResult.message);
    } catch (error) {
      next(error);
    }
  }

  static async enableIntegration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { provider } = req.params;
      const updated = await IntegrationService.enableIntegration(
        provider.toUpperCase(),
        req.user!.userId
      );
      return sendSuccess(res, updated, `${provider} integration enabled`);
    } catch (error) {
      next(error);
    }
  }

  static async disableIntegration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { provider } = req.params;
      const updated = await IntegrationService.disableIntegration(
        provider.toUpperCase(),
        req.user!.userId
      );
      return sendSuccess(res, updated, `${provider} integration disabled`);
    } catch (error) {
      next(error);
    }
  }
}
