const crypto = require('crypto');

/**
 * Generate a random API key with a given prefix.
 * @param {string} prefix
 * @returns {string}
 */
function generateApiKey(prefix = 'sk') {
  const token = crypto.randomBytes(32).toString('hex');
  return `${prefix}_${token}`;
}

/**
 * Hash an API key using SHA-256
 * @param {string} apiKey
 * @returns {string}
 */
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Get encryption key for API keys (from env or generate master key)
 * SECURITY: In production, API_KEY_ENCRYPTION_KEY is REQUIRED
 */
function getEncryptionKey() {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  
  if (process.env.API_KEY_ENCRYPTION_KEY) {
    // Use provided key (must be 32 bytes for AES-256)
    const key = Buffer.from(process.env.API_KEY_ENCRYPTION_KEY, 'hex');
    if (key.length === 32) {
      return key;
    }
    // If not 32 bytes, derive one using PBKDF2
    return crypto.pbkdf2Sync(process.env.API_KEY_ENCRYPTION_KEY, 'doclittle-api-keys', 100000, 32, 'sha256');
  }
  
  // SECURITY: In production, fail if encryption key is not set
  if (isProduction) {
    throw new Error('SECURITY ERROR: API_KEY_ENCRYPTION_KEY is required in production. API key encryption cannot proceed.');
  }
  
  // Development: warn and use default (for local testing only)
  console.warn('⚠️  API_KEY_ENCRYPTION_KEY not set - using default key derivation (DEVELOPMENT ONLY - NOT secure)');
  return crypto.pbkdf2Sync('doclittle-default-secret-change-in-production', 'doclittle-api-keys', 100000, 32, 'sha256');
}

/**
 * Encrypt an API key for storage (admin recoverable)
 * @param {string} apiKey
 * @returns {string} Encrypted key (hex string)
 */
function encryptApiKey(apiKey) {
  const algorithm = 'aes-256-gcm';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return: iv:authTag:encrypted (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an API key (admin only)
 * @param {string} encryptedKey
 * @returns {string} Decrypted API key
 */
function decryptApiKey(encryptedKey) {
  const algorithm = 'aes-256-gcm';
  const key = getEncryptionKey();
  
  const parts = encryptedKey.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted key format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Rotate merchant API key (Gap Analysis). Delegates to database.rotateMerchantApiKey.
 * @returns {{ apiKey: string, keyId: string }}
 */
function rotateMerchantApiKey(merchantId, revokedBy = 'system') {
  const db = require('../database');
  return db.rotateMerchantApiKey(merchantId, revokedBy);
}

module.exports = {
  generateApiKey,
  hashApiKey,
  encryptApiKey,
  decryptApiKey,
  rotateMerchantApiKey,
};

