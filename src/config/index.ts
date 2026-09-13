import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5001').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(8, 'JWT_ACCESS_SECRET must be at least 8 chars'),
  JWT_REFRESH_SECRET: z.string().min(8, 'JWT_REFRESH_SECRET must be at least 8 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('*'),
  TELEPHONY_WEBHOOK_SECRET: z.string().default('crm_telephony_secret'),
  FCM_SERVER_KEY: z.string().default('mock_fcm_key'),
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_ACCESS_TOKEN: z.string().default(''),
  META_PAGE_ID: z.string().default(''),
  META_WEBHOOK_VERIFY_TOKEN: z.string().default('estatepulse_meta_verify_token'),
  META_GRAPH_API_VERSION: z.string().default('v21.0'),
  ENCRYPTION_KEY: z.string().default('estatepulse_32_byte_secret_key_aes256'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
