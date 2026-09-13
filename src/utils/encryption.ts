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
  if (clean.length <= 8) return '********';
  return `${clean.substring(0, 6)}...${clean.substring(clean.length - 4)}`;
};
