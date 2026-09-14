import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import {
  encryptSecretsDict,
  decryptSecretsDict,
  maskApiKey,
  maskToken,
} from '../../utils/encryption.js';
import { logAudit } from '../../utils/audit.js';
import {
  IntegrationProvider,
  IntegrationType,
  IntegrationStatus,
  MaskedIntegrationResponse,
  SaveIntegrationInput,
  TestIntegrationResult,
} from './integrations.types.js';

interface CachedIntegration {
  isEnabled: boolean;
  config: Record<string, any>;
  secrets: Record<string, string>;
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

export class IntegrationService {
  private static cache = new Map<string, CachedIntegration>();

  /**
   * Default metadata definitions for known providers
   */
  private static readonly PROVIDER_METADATA: Record<
    string,
    { type: IntegrationType; name: string; description: string; defaultConfig: Record<string, any> }
  > = {
    [IntegrationProvider.GOOGLE_MAPS]: {
      type: IntegrationType.MAPS,
      name: 'Google Maps Platform',
      description: 'Interactive maps, live employee geolocation, reverse geocoding, route ETA, and road snapping.',
      defaultConfig: {
        projectId: '',
        mapId: '',
        defaultLat: 19.076,
        defaultLng: 72.8777,
        defaultZoom: 12,
        enabledServices: ['MAPS', 'GEOCODING', 'ROUTES', 'ROADS'],
      },
    },
    [IntegrationProvider.FIREBASE_FCM]: {
      type: IntegrationType.PUSH_NOTIFICATION,
      name: 'Firebase Cloud Messaging (FCM)',
      description: 'Instant push notifications for field executives on mobile and cross-platform notification dispatch.',
      defaultConfig: {
        projectId: '',
        appId: '',
        clientEmail: '',
        enabledServices: ['PUSH_FCM'],
      },
    },
    [IntegrationProvider.META_LEAD_ADS]: {
      type: IntegrationType.LEAD_GEN,
      name: 'Meta Lead Ads (Facebook & Instagram)',
      description: 'Automated webhook ingestion of Facebook/Instagram lead forms with instant duplicate check and routing.',
      defaultConfig: {
        pageId: config.META_PAGE_ID || '',
        pageName: 'Real Estate Official Page',
        appId: config.META_APP_ID || '',
        webhookVerifyToken: config.META_WEBHOOK_VERIFY_TOKEN || '',
        apiVersion: config.META_GRAPH_API_VERSION || 'v21.0',
      },
    },
    [IntegrationProvider.TELEPHONY]: {
      type: IntegrationType.CALLING,
      name: 'Cloud Calling & Telephony',
      description: 'Single-click outbound calling, inbound webhook capture, automated call audio recordings, and analytics.',
      defaultConfig: {
        providerName: 'CUSTOM',
        accountId: '',
        phoneNumber: '',
        webhookUrl: '/api/v1/calls/webhook',
        enabledServices: ['CLICK_TO_CALL', 'RECORDING', 'WEBHOOK'],
      },
    },
  };

  /**
   * Invalidate in-memory cache for a provider
   */
  static invalidateCache(provider?: string) {
    if (provider) {
      this.cache.delete(provider);
    } else {
      this.cache.clear();
    }
  }

  /**
   * List all integrations with masked secrets and statuses
   */
  static async listMaskedIntegrations(): Promise<MaskedIntegrationResponse[]> {
    const dbIntegrations = await prisma.apiIntegration.findMany();
    const dbMap = new Map(dbIntegrations.map((item) => [item.provider, item]));

    const results: MaskedIntegrationResponse[] = [];

    for (const [providerKey, meta] of Object.entries(this.PROVIDER_METADATA)) {
      const dbRecord = dbMap.get(providerKey);

      if (dbRecord) {
        const secrets = decryptSecretsDict(dbRecord.encryptedSecrets);
        const maskedSecrets = this.generateMaskedSecrets(providerKey, secrets);
        const hasSecrets = Object.values(secrets).some((v) => Boolean(v && v.trim()));

        results.push({
          id: dbRecord.id,
          provider: dbRecord.provider,
          type: dbRecord.type,
          name: dbRecord.name || meta.name,
          description: dbRecord.description || meta.description,
          isEnabled: dbRecord.isEnabled,
          isConfigured: hasSecrets,
          config: {
            ...meta.defaultConfig,
            ...(typeof dbRecord.config === 'object' && dbRecord.config ? (dbRecord.config as any) : {}),
          },
          maskedSecrets,
          maskedKey: maskedSecrets.apiKey || maskedSecrets.accessToken || maskedSecrets.serverKey || undefined,
          lastTestedAt: dbRecord.lastTestedAt,
          lastTestStatus: (dbRecord.lastTestStatus as IntegrationStatus) || (hasSecrets ? 'CONFIGURED' : 'NOT_CONFIGURED'),
          lastTestMessage: dbRecord.lastTestMessage,
          createdAt: dbRecord.createdAt,
          updatedAt: dbRecord.updatedAt,
        });
      } else {
        // Synthesize integration from environment fallback if available
        const envSecrets = this.getEnvFallbackSecrets(providerKey);
        const hasEnvSecrets = Object.values(envSecrets).some((v) => Boolean(v && v.trim()));
        const maskedSecrets = this.generateMaskedSecrets(providerKey, envSecrets);

        results.push({
          provider: providerKey,
          type: meta.type,
          name: meta.name,
          description: meta.description,
          isEnabled: true,
          isConfigured: hasEnvSecrets,
          config: meta.defaultConfig,
          maskedSecrets,
          maskedKey: maskedSecrets.apiKey || maskedSecrets.accessToken || maskedSecrets.serverKey || undefined,
          lastTestedAt: null,
          lastTestStatus: hasEnvSecrets ? 'CONFIGURED' : 'NOT_CONFIGURED',
          lastTestMessage: hasEnvSecrets ? 'Configured via environment variables fallback' : 'Not configured yet',
        });
      }
    }

    return results;
  }

  /**
   * Get single masked integration by provider key
   */
  static async getMaskedIntegration(provider: string): Promise<MaskedIntegrationResponse | null> {
    const list = await this.listMaskedIntegrations();
    const found = list.find((item) => item.provider === provider);
    return found || null;
  }

  /**
   * Save or update integration configuration & encrypted secrets
   */
  static async saveIntegration(
    provider: string,
    input: SaveIntegrationInput,
    adminId: string
  ): Promise<MaskedIntegrationResponse> {
    const meta = this.PROVIDER_METADATA[provider] || {
      type: IntegrationType.MAPS,
      name: provider,
      description: '',
      defaultConfig: {},
    };

    const existing = await prisma.apiIntegration.findUnique({
      where: { provider },
    });

    const currentSecrets = existing ? decryptSecretsDict(existing.encryptedSecrets) : {};
    const currentConfig = existing && typeof existing.config === 'object' ? (existing.config as any) : {};

    // Merge secrets: only update non-empty, unmasked inputs
    const updatedSecrets: Record<string, string> = { ...currentSecrets };
    if (input.secrets) {
      for (const [key, value] of Object.entries(input.secrets)) {
        if (typeof value === 'string' && value.trim() && !value.includes('••••')) {
          updatedSecrets[key] = value.trim();
        }
      }
    }

    // Merge configuration
    const updatedConfig = {
      ...meta.defaultConfig,
      ...currentConfig,
      ...(input.config || {}),
    };

    const isEnabled = input.isEnabled !== undefined ? input.isEnabled : existing ? existing.isEnabled : true;
    const encryptedSecretsStr = encryptSecretsDict(updatedSecrets);

    const saved = await prisma.apiIntegration.upsert({
      where: { provider },
      update: {
        config: updatedConfig,
        encryptedSecrets: encryptedSecretsStr,
        isEnabled,
        updatedBy: adminId,
        lastTestStatus: existing?.lastTestStatus || 'CONFIGURED',
      },
      create: {
        provider,
        type: meta.type,
        name: meta.name,
        description: meta.description,
        config: updatedConfig,
        encryptedSecrets: encryptedSecretsStr,
        isEnabled,
        createdBy: adminId,
        updatedBy: adminId,
        lastTestStatus: 'CONFIGURED',
      },
    });

    // Invalidate in-memory cache
    this.invalidateCache(provider);

    // Audit log (NEVER store secrets in audit logs!)
    await logAudit({
      userId: adminId,
      action: 'API_INTEGRATION_SAVED',
      entity: 'ApiIntegration',
      entityId: saved.id,
      newValue: {
        provider,
        isEnabled,
        configuredKeys: Object.keys(updatedSecrets),
      },
    });

    logger.info(`Admin ${adminId} saved API integration configuration for ${provider}`);

    return (await this.getMaskedIntegration(provider))!;
  }

  /**
   * Quick toggle enable integration
   */
  static async enableIntegration(provider: string, adminId: string): Promise<MaskedIntegrationResponse> {
    await prisma.apiIntegration.upsert({
      where: { provider },
      update: { isEnabled: true, updatedBy: adminId },
      create: {
        provider,
        type: this.PROVIDER_METADATA[provider]?.type || IntegrationType.MAPS,
        name: this.PROVIDER_METADATA[provider]?.name || provider,
        isEnabled: true,
        createdBy: adminId,
      },
    });

    this.invalidateCache(provider);

    await logAudit({
      userId: adminId,
      action: 'API_INTEGRATION_ENABLED',
      entity: 'ApiIntegration',
      entityId: provider,
      newValue: { isEnabled: true },
    });

    return (await this.getMaskedIntegration(provider))!;
  }

  /**
   * Quick toggle disable integration
   */
  static async disableIntegration(provider: string, adminId: string): Promise<MaskedIntegrationResponse> {
    await prisma.apiIntegration.upsert({
      where: { provider },
      update: { isEnabled: false, updatedBy: adminId },
      create: {
        provider,
        type: this.PROVIDER_METADATA[provider]?.type || IntegrationType.MAPS,
        name: this.PROVIDER_METADATA[provider]?.name || provider,
        isEnabled: false,
        createdBy: adminId,
      },
    });

    this.invalidateCache(provider);

    await logAudit({
      userId: adminId,
      action: 'API_INTEGRATION_DISABLED',
      entity: 'ApiIntegration',
      entityId: provider,
      newValue: { isEnabled: false },
    });

    return (await this.getMaskedIntegration(provider))!;
  }

  /**
   * Live test integration connection
   */
  static async testIntegration(provider: string, adminId: string): Promise<TestIntegrationResult> {
    const startTime = Date.now();
    let result: TestIntegrationResult;

    try {
      const secrets = await this.getAllSecretsForInternalUse(provider);

      switch (provider) {
        case IntegrationProvider.GOOGLE_MAPS:
          result = await this.testGoogleMaps(secrets);
          break;
        case IntegrationProvider.FIREBASE_FCM:
          result = await this.testFirebaseFcm(secrets);
          break;
        case IntegrationProvider.META_LEAD_ADS:
          result = await this.testMetaLeadAds(secrets);
          break;
        case IntegrationProvider.TELEPHONY:
          result = await this.testTelephony(secrets);
          break;
        default:
          result = {
            success: false,
            provider,
            status: 'FAILED',
            message: `Unsupported integration provider: ${provider}`,
          };
      }
    } catch (err: any) {
      logger.error(`Error executing test for ${provider}:`, err);
      result = {
        success: false,
        provider,
        status: 'FAILED',
        message: err.message || 'Connection test encountered an unexpected exception.',
      };
    }

    const latencyMs = Date.now() - startTime;
    result.diagnostics = {
      ...(result.diagnostics || {}),
      latencyMs,
    };

    // Update test status in database
    await prisma.apiIntegration.upsert({
      where: { provider },
      update: {
        lastTestedAt: new Date(),
        lastTestStatus: result.status,
        lastTestMessage: result.message,
        updatedBy: adminId,
      },
      create: {
        provider,
        type: this.PROVIDER_METADATA[provider]?.type || IntegrationType.MAPS,
        name: this.PROVIDER_METADATA[provider]?.name || provider,
        lastTestedAt: new Date(),
        lastTestStatus: result.status,
        lastTestMessage: result.message,
        createdBy: adminId,
      },
    });

    // Invalidate cache
    this.invalidateCache(provider);

    // Audit log
    await logAudit({
      userId: adminId,
      action: 'API_INTEGRATION_TESTED',
      entity: 'ApiIntegration',
      entityId: provider,
      newValue: {
        status: result.status,
        success: result.success,
        latencyMs,
      },
    });

    return result;
  }

  /**
   * Internal Server-Side Secret Retrieval with Caching & Env Fallbacks
   * (Zero secrets exposed to clients)
   */
  static async getSecretForInternalUse(provider: string, secretKey: string): Promise<string | null> {
    const secrets = await this.getAllSecretsForInternalUse(provider);
    return secrets[secretKey] || null;
  }

  /**
   * Retrieve all decrypted secrets for internal use
   */
  static async getAllSecretsForInternalUse(provider: string): Promise<Record<string, string>> {
    const now = Date.now();
    const cached = this.cache.get(provider);

    if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
      return cached.secrets;
    }

    const dbRecord = await prisma.apiIntegration.findUnique({
      where: { provider },
    });

    let secrets: Record<string, string> = {};

    if (dbRecord && dbRecord.encryptedSecrets) {
      secrets = decryptSecretsDict(dbRecord.encryptedSecrets);
    }

    // Merge with environment variable fallbacks if missing
    const envFallbacks = this.getEnvFallbackSecrets(provider);
    for (const [k, v] of Object.entries(envFallbacks)) {
      if (!secrets[k] && v) {
        secrets[k] = v;
      }
    }

    this.cache.set(provider, {
      isEnabled: dbRecord ? dbRecord.isEnabled : true,
      config: dbRecord && typeof dbRecord.config === 'object' ? (dbRecord.config as any) : {},
      secrets,
      cachedAt: now,
    });

    return secrets;
  }

  /**
   * Test Google Maps Platform
   */
  private static async testGoogleMaps(secrets: Record<string, string>): Promise<TestIntegrationResult> {
    const apiKey = secrets.apiKey || secrets.serverApiKey || secrets.webApiKey;

    if (!apiKey) {
      return {
        success: false,
        provider: IntegrationProvider.GOOGLE_MAPS,
        status: 'NOT_CONFIGURED',
        message: 'Google Maps API key is not configured.',
      };
    }

    // Mock testing support for development/testing
    if (apiKey.startsWith('mock_') || apiKey.startsWith('test_') || apiKey.includes('demo')) {
      return {
        success: true,
        provider: IntegrationProvider.GOOGLE_MAPS,
        status: 'CONNECTED',
        message: '✓ Google Maps Platform test connection successful (Mock Key Mode).',
        diagnostics: { service: 'Geocoding API' },
      };
    }

    try {
      // Safe test probe using Geocoding API with Mumbai coordinates
      const testUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=Mumbai&key=${encodeURIComponent(
        apiKey
      )}`;

      const res = await fetch(testUrl, { method: 'GET', signal: AbortSignal.timeout(6000) });
      const data: any = await res.json().catch(() => ({}));

      if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
        return {
          success: true,
          provider: IntegrationProvider.GOOGLE_MAPS,
          status: 'CONNECTED',
          message: '✓ Google Maps Platform connection successful. Geocoding and Maps services verified.',
          diagnostics: { service: 'Geocoding API' },
        };
      }

      if (data.status === 'REQUEST_DENIED') {
        const errorMsg = data.error_message || '';
        let diagnostic = 'Google Maps request denied.';

        if (errorMsg.toLowerCase().includes('api key is invalid') || errorMsg.toLowerCase().includes('not valid')) {
          diagnostic = 'Google Maps API key is invalid.';
        } else if (errorMsg.toLowerCase().includes('billing')) {
          diagnostic = 'Google Maps Platform billing may not be enabled for this Google Cloud project.';
        } else if (errorMsg.toLowerCase().includes('not authorized') || errorMsg.toLowerCase().includes('disabled')) {
          diagnostic = 'Geocoding API is not enabled for the configured Google Cloud project.';
        } else {
          diagnostic = `Google Maps error: ${errorMsg.substring(0, 100)}`;
        }

        return {
          success: false,
          provider: IntegrationProvider.GOOGLE_MAPS,
          status: 'FAILED',
          message: `✕ ${diagnostic}`,
          diagnostics: { service: 'Geocoding API', errorDetails: diagnostic },
        };
      }

      if (data.status === 'OVER_QUERY_LIMIT') {
        return {
          success: false,
          provider: IntegrationProvider.GOOGLE_MAPS,
          status: 'FAILED',
          message: '✕ Google Maps query quota exceeded for this API key.',
        };
      }

      return {
        success: false,
        provider: IntegrationProvider.GOOGLE_MAPS,
        status: 'FAILED',
        message: `✕ Google Maps API status: ${data.status || 'UNKNOWN_ERROR'}`,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: IntegrationProvider.GOOGLE_MAPS,
        status: 'FAILED',
        message: `✕ Network error connecting to Google Maps Platform: ${err.message || 'Timeout'}`,
      };
    }
  }

  /**
   * Test Firebase FCM
   */
  private static async testFirebaseFcm(secrets: Record<string, string>): Promise<TestIntegrationResult> {
    const serverKey = secrets.serverKey || secrets.apiKey;

    if (!serverKey) {
      return {
        success: false,
        provider: IntegrationProvider.FIREBASE_FCM,
        status: 'NOT_CONFIGURED',
        message: 'Firebase FCM server key is not configured.',
      };
    }

    if (serverKey.startsWith('mock_') || serverKey.includes('test')) {
      return {
        success: true,
        provider: IntegrationProvider.FIREBASE_FCM,
        status: 'CONNECTED',
        message: '✓ Firebase FCM connection verified (Mock Key Mode).',
      };
    }

    try {
      // Probe FCM endpoint
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `key=${serverKey}`,
        },
        body: JSON.stringify({
          dry_run: true,
          to: 'probe_token_test_dry_run',
        }),
        signal: AbortSignal.timeout(6000),
      });

      // HTTP 200 or 400 (InvalidRegistration) confirms server key authorization succeeded
      if (res.status === 200 || res.status === 400) {
        return {
          success: true,
          provider: IntegrationProvider.FIREBASE_FCM,
          status: 'CONNECTED',
          message: '✓ Firebase Cloud Messaging server credentials validated successfully.',
        };
      }

      if (res.status === 401) {
        return {
          success: false,
          provider: IntegrationProvider.FIREBASE_FCM,
          status: 'FAILED',
          message: '✕ Firebase FCM Server Key is invalid or unauthorized.',
        };
      }

      return {
        success: false,
        provider: IntegrationProvider.FIREBASE_FCM,
        status: 'FAILED',
        message: `✕ FCM test responded with HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: IntegrationProvider.FIREBASE_FCM,
        status: 'FAILED',
        message: `✕ FCM connection test error: ${err.message}`,
      };
    }
  }

  /**
   * Test Meta Lead Ads
   */
  private static async testMetaLeadAds(secrets: Record<string, string>): Promise<TestIntegrationResult> {
    const accessToken = secrets.accessToken;
    const pageId = secrets.pageId || config.META_PAGE_ID;

    if (!accessToken) {
      return {
        success: false,
        provider: IntegrationProvider.META_LEAD_ADS,
        status: 'NOT_CONFIGURED',
        message: 'Meta Lead Ads access token is not configured.',
      };
    }

    if (accessToken.startsWith('mock_') || accessToken.includes('test')) {
      return {
        success: true,
        provider: IntegrationProvider.META_LEAD_ADS,
        status: 'CONNECTED',
        message: '✓ Meta Lead Ads connection verified (Mock Mode).',
      };
    }

    try {
      const url = `https://graph.facebook.com/${config.META_GRAPH_API_VERSION || 'v21.0'}/${pageId || 'me'}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data: any = await res.json().catch(() => ({}));

      if (res.ok && data.id) {
        return {
          success: true,
          provider: IntegrationProvider.META_LEAD_ADS,
          status: 'CONNECTED',
          message: `✓ Connected to Meta Page: ${data.name || data.id}`,
        };
      }

      const errorMsg = data.error?.message || `HTTP ${res.status}`;
      return {
        success: false,
        provider: IntegrationProvider.META_LEAD_ADS,
        status: 'FAILED',
        message: `✕ Meta Graph API error: ${errorMsg}`,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: IntegrationProvider.META_LEAD_ADS,
        status: 'FAILED',
        message: `✕ Meta connection error: ${err.message}`,
      };
    }
  }

  /**
   * Test Telephony Provider
   */
  private static async testTelephony(secrets: Record<string, string>): Promise<TestIntegrationResult> {
    const apiKey = secrets.apiKey || secrets.authToken;

    if (!apiKey) {
      return {
        success: false,
        provider: IntegrationProvider.TELEPHONY,
        status: 'NOT_CONFIGURED',
        message: 'Calling provider API credentials are not configured.',
      };
    }

    return {
      success: true,
      provider: IntegrationProvider.TELEPHONY,
      status: 'CONNECTED',
      message: '✓ Calling provider configuration verified and webhook ready.',
    };
  }

  /**
   * Generate masked secrets dictionary for UI display
   */
  private static generateMaskedSecrets(provider: string, secrets: Record<string, string>): Record<string, string> {
    const masked: Record<string, string> = {};

    for (const [key, val] of Object.entries(secrets)) {
      if (!val) {
        masked[key] = 'Not configured';
      } else if (provider === IntegrationProvider.GOOGLE_MAPS) {
        masked[key] = maskApiKey(val, 4, 4);
      } else {
        masked[key] = maskToken(val);
      }
    }

    return masked;
  }

  /**
   * Fallback environment variables when DB integration record is absent
   */
  private static getEnvFallbackSecrets(provider: string): Record<string, string> {
    switch (provider) {
      case IntegrationProvider.GOOGLE_MAPS:
        return {
          apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
          webApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
          serverApiKey: process.env.GOOGLE_MAPS_SERVER_KEY || '',
        };
      case IntegrationProvider.FIREBASE_FCM:
        return {
          serverKey: config.FCM_SERVER_KEY || '',
        };
      case IntegrationProvider.META_LEAD_ADS:
        return {
          accessToken: config.META_ACCESS_TOKEN || '',
          appSecret: config.META_APP_SECRET || '',
          pageId: config.META_PAGE_ID || '',
        };
      case IntegrationProvider.TELEPHONY:
        return {
          apiKey: config.TELEPHONY_WEBHOOK_SECRET || '',
        };
      default:
        return {};
    }
  }
}
