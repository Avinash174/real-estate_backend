/**
 * Phone normalization utility for Indian phone numbers
 */

export interface NormalizedPhone {
  raw: string;
  e164: string;           // +919876543210
  national: string;       // 9876543210
  searchVariants: string[]; // ['+919876543210', '9876543210', '919876543210', '09876543210']
  isValid: boolean;
}

export const normalizeIndianPhone = (input: string): NormalizedPhone => {
  if (!input) {
    return { raw: '', e164: '', national: '', searchVariants: [], isValid: false };
  }

  const raw = String(input).trim();
  // Strip all non-digit characters except leading plus
  let cleaned = raw.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // Remove leading zeros
  while (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // If starts with 91 and has 12 digits total
  let national = cleaned;
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    national = cleaned.substring(2);
  }

  // Standard Indian mobile number is 10 digits
  const isValid = national.length === 10 && /^[6-9]\d{9}$/.test(national);
  const e164 = isValid ? `+91${national}` : `+${cleaned}`;

  const searchVariants = Array.from(
    new Set([
      e164,
      national,
      `91${national}`,
      `0${national}`,
      raw,
    ])
  ).filter(Boolean);

  return {
    raw,
    e164,
    national,
    searchVariants,
    isValid,
  };
};
