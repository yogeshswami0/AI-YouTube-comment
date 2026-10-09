import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 32-byte key from the TOKEN_ENCRYPTION_KEY env variable.
 */
function getKey() {
  return crypto
    .createHash('sha256')
    .update(env.TOKEN_ENCRYPTION_KEY)
    .digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a single base64-encoded string containing iv + authTag + ciphertext.
 */
export function encrypt(plaintext) {
  if (!plaintext) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: iv (16) + authTag (16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypts a base64-encoded string produced by encrypt().
 * If decryption fails (e.g. legacy plaintext token), returns the original value.
 */
export function decrypt(packed64) {
  if (!packed64) return packed64;

  try {
    const key = getKey();
    const packed = Buffer.from(packed64, 'base64');

    // Encrypted tokens must be at least iv(16) + authTag(16) + 1 byte of ciphertext
    if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
      return packed64; // Too short to be encrypted — return as plaintext
    }

    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    // Decryption failed — likely a legacy plaintext token
    return packed64;
  }
}
