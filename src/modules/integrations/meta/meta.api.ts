import crypto from 'crypto';
import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { decryptToken } from '../../../utils/encryption.js';

export interface MetaLeadgenFieldData {
  name: string;
  values: string[];
}

export interface MetaLeadDetails {
  id: string;
  created_time: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  form_name?: string;
  page_id?: string;
  page_name?: string;
  field_data: MetaLeadgenFieldData[];
  rawPayload?: any;
}

export class MetaApiClient {
  private readonly baseUrl: string;
  private readonly version: string;

  constructor(version = config.META_GRAPH_API_VERSION || 'v21.0') {
    this.version = version;
    this.baseUrl = `https://graph.facebook.com/${this.version}`;
  }

  /**
   * Verify Meta Webhook HMAC-SHA256 signature
   */
  static verifyWebhookSignature(payload: string | Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!signatureHeader || !appSecret) {
      if (config.NODE_ENV === 'development') {
        return true;
      }
      return false;
    }

    const parts = signatureHeader.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
      return false;
    }

    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex');

    try {
      const expectedBuffer = Buffer.from(expectedHash, 'hex');
      const signatureBuffer = Buffer.from(parts[1], 'hex');
      if (expectedBuffer.length !== signatureBuffer.length) return false;
      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Test Page Access Token validity and fetch Page info
   */
  async testConnection(accessToken: string, pageId?: string): Promise<{ success: boolean; page?: any; error?: string }> {
    try {
      const plainToken = decryptToken(accessToken);
      const targetId = pageId || 'me';
      const url = `${this.baseUrl}/${targetId}?access_token=${encodeURIComponent(plainToken)}&fields=id,name,category,link`;

      const response = await fetch(url);
      const data = (await response.json()) as any;

      if (!response.ok || data.error) {
        const msg = data.error?.message || `HTTP ${response.status} error`;
        logger.error(`Meta API test connection failed: ${msg}`);
        return { success: false, error: msg };
      }

      return {
        success: true,
        page: data,
      };
    } catch (error: any) {
      logger.error(`Meta API test connection failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Fetch Lead Details from Meta Graph API using leadgen_id
   */
  async getLeadDetails(leadgenId: string, accessToken: string): Promise<MetaLeadDetails> {
    const plainToken = decryptToken(accessToken);
    logger.info(`META_LEAD_FETCH_STARTED: Fetching lead details for Meta Lead ID: ${leadgenId}`);

    const fields = [
      'id',
      'created_time',
      'field_data',
      'form_id',
      'ad_id',
      'ad_name',
      'adset_id',
      'adset_name',
      'campaign_id',
      'campaign_name',
      'page_id',
    ].join(',');

    const url = `${this.baseUrl}/${leadgenId}?access_token=${encodeURIComponent(plainToken)}&fields=${fields}`;

    try {
      const response = await fetch(url);
      const data = (await response.json()) as any;

      if (!response.ok || data.error) {
        const errData = data.error;
        logger.error(`META_LEAD_IMPORT_FAILED: Meta API error for Lead ID ${leadgenId}: status=${response.status}, message=${errData?.message || 'Unknown error'}`);

        if (errData?.code === 190) {
          logger.error('META_TOKEN_ERROR: Meta access token expired or invalid');
        } else if (errData?.code === 4 || errData?.code === 17) {
          logger.warn('META_RATE_LIMIT: Meta API rate limit hit');
        }

        throw new Error(errData?.message || `Failed to fetch lead: HTTP ${response.status}`);
      }

      logger.info(`META_LEAD_FETCH_SUCCESS: Successfully retrieved lead details for ID: ${leadgenId}`);

      return {
        id: data.id,
        created_time: data.created_time,
        ad_id: data.ad_id,
        ad_name: data.ad_name,
        adset_id: data.adset_id,
        adset_name: data.adset_name,
        campaign_id: data.campaign_id,
        campaign_name: data.campaign_name,
        form_id: data.form_id,
        form_name: data.form_name,
        page_id: data.page_id,
        field_data: data.field_data || [],
        rawPayload: data,
      };
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Fetch forms and leads for a page for manual reconciliation/sync
   */
  async getPageLeads(pageId: string, accessToken: string, sinceDate?: Date): Promise<MetaLeadDetails[]> {
    const plainToken = decryptToken(accessToken);
    try {
      const formsUrl = `${this.baseUrl}/${pageId}/leadgen_forms?access_token=${encodeURIComponent(plainToken)}&fields=id,name,status`;
      const formsRes = await fetch(formsUrl);
      const formsData = (await formsRes.json()) as any;

      const forms = formsData.data || [];
      const allLeads: MetaLeadDetails[] = [];

      for (const form of forms) {
        let leadsUrl = `${this.baseUrl}/${form.id}/leads?access_token=${encodeURIComponent(plainToken)}&fields=id,created_time,field_data,form_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name&limit=50`;

        if (sinceDate) {
          leadsUrl += `&filtering=[{field:'time_created',operator:'GREATER_THAN',value:${Math.floor(sinceDate.getTime() / 1000)}}]`;
        }

        const leadsRes = await fetch(leadsUrl);
        const leadsData = (await leadsRes.json()) as any;
        const leads = leadsData.data || [];

        for (const l of leads) {
          allLeads.push({
            id: l.id,
            created_time: l.created_time,
            ad_id: l.ad_id,
            ad_name: l.ad_name,
            adset_id: l.adset_id,
            adset_name: l.adset_name,
            campaign_id: l.campaign_id,
            campaign_name: l.campaign_name,
            form_id: form.id,
            form_name: form.name,
            page_id: pageId,
            field_data: l.field_data || [],
            rawPayload: l,
          });
        }
      }

      return allLeads;
    } catch (error: any) {
      logger.error(`Error fetching page leads for sync: ${error.message}`);
      throw error;
    }
  }
}

export const metaApiClient = new MetaApiClient();
