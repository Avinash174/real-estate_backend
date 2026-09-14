import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a 32-byte key from the configured encryption key string
 */
const getEncryptionKey = (): Buffer => {
  const secret = config.ENCRYPTION_KEY || 'estatepulse_default_32byte_secr';
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypt plain text using AES-256-GCM
 * Returns formatted string: ivHex:authTagHex:ciphertextHex
 */
export const encryptToken = (plainText: string): string => {
  if (!plainText) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

/**
 * Decrypt cipher text using AES-256-GCM
 */
export const decryptToken = (encryptedText: string): string => {
  if (!encryptedText) return '';
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      // In case token was stored unencrypted previously
      return encryptedText;
    }

    const [ivHex, authTagHex, cipherHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // If decryption fails, return as-is (e.g. if plain text was passed)
    return encryptedText;
  }
};

/**
 * Mask token for safe API display
 * e.g. "EAAGNO...1234"
 */
export const maskToken = (token: string): string => {
  if (!token) return 'Not configured';
  const clean = token.includes(':') ? decryptToken(token) : token;
  if (!clean || clean.length === 0) return 'Not configured';
  if (clean.length <= 8) return '••••••••';
  return `${clean.substring(0, 4)}••••••••${clean.substring(clean.length - 4)}`;
};

/**
 * Mask API keys for safe display: e.g. "AIza••••••••9XK2"
 */
export const maskApiKey = (key?: string | null, prefixLen = 4, suffixLen = 4): string => {
  if (!key) return 'Not configured';
  const clean = key.includes(':') ? decryptToken(key) : key;
  if (!clean || clean.length === 0) return 'Not configured';
  if (clean.length <= prefixLen + suffixLen) return '••••••••••••••••';

  const prefix = clean.substring(0, prefixLen);
  const suffix = clean.substring(clean.length - suffixLen);
  return `${prefix}••••••••${suffix}`;
};

/**
 * Encrypt a dictionary of secrets into an AES-256-GCM string
 */
export const encryptSecretsDict = (secrets: Record<string, any>): string => {
  if (!secrets || Object.keys(secrets).length === 0) return '';
  return encryptToken(JSON.stringify(secrets));
};

/**
 * Decrypt an AES-256-GCM string back into a dictionary of secrets
 */
export const decryptSecretsDict = (encryptedStr?: string | null): Record<string, any> => {
  if (!encryptedStr) return {};
  try {
    const jsonStr = decryptToken(encryptedStr);
    return JSON.parse(jsonStr);
  } catch (err) {
    return {};
  }
};
