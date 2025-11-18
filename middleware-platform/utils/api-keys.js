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
 * This should be set in production via API_KEY_ENCRYPTION_KEY env variable
 */
function getEncryptionKey() {
  if (process.env.API_KEY_ENCRYPTION_KEY) {
    // Use provided key (must be 32 bytes for AES-256)
    const key = Buffer.from(process.env.API_KEY_ENCRYPTION_KEY, 'hex');
    if (key.length === 32) {
      return key;
    }
    // If not 32 bytes, derive one using PBKDF2
    return crypto.pbkdf2Sync(process.env.API_KEY_ENCRYPTION_KEY, 'doclittle-api-keys', 100000, 32, 'sha256');
  }
  // Fallback: use a derived key from a default secret (NOT for production)
  // In production, always set API_KEY_ENCRYPTION_KEY
  console.warn('⚠️  API_KEY_ENCRYPTION_KEY not set - using default key derivation (NOT secure for production)');
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

module.exports = {
  generateApiKey,
  hashApiKey,
  encryptApiKey,
  decryptApiKey,
};

