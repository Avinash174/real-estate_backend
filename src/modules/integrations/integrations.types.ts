export enum IntegrationProvider {
  GOOGLE_MAPS = 'GOOGLE_MAPS',
  FIREBASE_FCM = 'FIREBASE_FCM',
  META_LEAD_ADS = 'META_LEAD_ADS',
  TELEPHONY = 'TELEPHONY',
}

export enum IntegrationType {
  MAPS = 'MAPS',
  PUSH_NOTIFICATION = 'PUSH_NOTIFICATION',
  LEAD_GEN = 'LEAD_GEN',
  CALLING = 'CALLING',
}

export type IntegrationStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'CONNECTED' | 'FAILED' | 'DISABLED';

export type GoogleMapsServiceKey = 'MAPS' | 'GEOCODING' | 'ROUTES' | 'ROADS';

export interface GoogleMapsConfig {
  projectId?: string;
  mapId?: string;
  defaultLat?: number;
  defaultLng?: number;
  defaultZoom?: number;
  enabledServices: GoogleMapsServiceKey[];
}

export interface FirebaseFcmConfig {
  projectId?: string;
  appId?: string;
  clientEmail?: string;
  enabledServices?: string[];
}

export interface MetaLeadAdsConfig {
  pageId?: string;
  pageName?: string;
  appId?: string;
  webhookVerifyToken?: string;
  apiVersion?: string;
}

export interface TelephonyConfig {
  providerName?: string; // 'TWILIO' | 'EXOTEL' | 'CUSTOM'
  accountId?: string;
  phoneNumber?: string;
  webhookUrl?: string;
  enabledServices?: string[];
}

export interface MaskedIntegrationResponse {
  id?: string;
  provider: IntegrationProvider | string;
  type: IntegrationType | string;
  name: string;
  description?: string | null;
  isEnabled: boolean;
  isConfigured: boolean;
  config: Record<string, any>;
  maskedSecrets: Record<string, string>;
  lastTestedAt?: Date | string | null;
  lastTestStatus?: IntegrationStatus | string | null;
  lastTestMessage?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface SaveIntegrationInput {
  isEnabled?: boolean;
  config?: Record<string, any>;
  secrets?: Record<string, string>; // Only non-empty strings are updated
}

export interface TestIntegrationResult {
  success: boolean;
  provider: string;
  status: IntegrationStatus;
  message: string;
  diagnostics?: {
    service?: string;
    latencyMs?: number;
    errorDetails?: string;
  };
}
