import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * AES-256-GCM encryption for OAuth tokens at rest. The key is derived from
 * APP_SECRET, which lives only in the server environment.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const FORMAT_VERSION = 'v1';

const KEY_SALT = 'central-lia:oauth-tokens:v1';
const keyCache = new Map<string, Buffer>();

/** scrypt makes brute-forcing a weak APP_SECRET from a stolen database expensive. */
function deriveKey(secret: string): Buffer {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const key = scryptSync(secret, KEY_SALT, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  keyCache.set(secret, key);
  return key;
}

export function encryptSecret(plainText: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== FORMAT_VERSION || !iv || !tag || !data) {
    throw new Error('Formato de segredo criptografado desconhecido');
  }
  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
