/**
 * Payment Security (4.4)
 * Credential validation, PCI scope, log sanitization.
 *
 * PCI DSS: Do not log full card numbers, CVV, or full API keys.
 * Tokens (payment_method_id, mandate_id, client_secret) are sensitive.
 */

const SENSITIVE_KEYS = [
  'payment_method_id', 'payment_method_id ', 'client_secret', 'authorization',
  'api_key', 'apiKey', 'secret_key', 'secretKey', 'STRIPE_SECRET_KEY',
  'mandate_id', 'mandateId', 'token', 'password'
];

/**
 * Sanitize object for logging - redact sensitive fields.
 * @param {Object} obj - Any object
 * @returns {Object} Copy with sensitive values redacted
 */
function sanitizeForLog(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const keyLower = String(k).toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some(s => keyLower.includes(s.toLowerCase()));
    if (isSensitive && v != null && v !== '') {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null && !(v instanceof Date)) {
      out[k] = sanitizeForLog(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Validate that we never log raw credentials.
 * Call before logging payment-related objects.
 */
function safeLogPayment(label, obj) {
  const sanitized = sanitizeForLog(obj);
  if (process.env.NODE_ENV === 'production' && process.env.LOG_PAYMENT_DEBUG !== '1') {
    return; // Skip verbose payment logs in prod unless explicitly enabled
  }
  console.log(label, JSON.stringify(sanitized));
}

/**
 * Ensure API key is present but never log it.
 * @param {string} keyName - Env var name, e.g. STRIPE_SECRET_KEY
 * @returns {boolean} True if set and non-empty
 */
function hasCredential(keyName) {
  const v = process.env[keyName];
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * PCI scope: payment_method_id and similar tokens must not be stored
 * in plaintext logs or analytics. Use sanitizeForLog before any log.
 */
const PCI_SCOPE = {
  inScope: ['payment_method_id', 'client_secret', 'mandate_id', 'payment_token'],
  neverLog: ['card number', 'cvv', 'full PAN'],
  storedTokens: 'Store only tokenized IDs; never raw card data.'
};

module.exports = {
  sanitizeForLog,
  safeLogPayment,
  hasCredential,
  PCI_SCOPE
};
