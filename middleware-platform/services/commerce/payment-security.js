/**
 * Payment Security (4.4)
 * Credential validation, PCI scope, log sanitization.
 *
 * PCI DSS: Do not log full card numbers, CVV, or full API keys.
 * Tokens (payment_method_id, mandate_id, client_secret) are sensitive.
 * HIPAA: Do not log PHI/PII (email, phone, name, message content).
 */

const SENSITIVE_KEYS = [
  'payment_method_id', 'payment_method_id ', 'client_secret', 'authorization',
  'api_key', 'apiKey', 'secret_key', 'secretKey', 'STRIPE_SECRET_KEY',
  'mandate_id', 'mandateId', 'token', 'password', 'verification_code', 'code',
  'cookie', 'x-api-key', 'x-auth-token', 'x-session-token'
];

const PII_KEYS = [
  'patient_email', 'patient_phone', 'patient_name', 'customer_email', 'customer_phone', 'customer_name',
  'email', 'phone', 'name', 'message', 'content', 'transcript_or_message', 'notes', 'reason',
  'From', 'To', 'Body', 'transcript', 'text', 'to_email', 'to_phone'
];

const ALL_REDACT_KEYS = [...new Set([...SENSITIVE_KEYS, ...PII_KEYS])];

/**
 * Sanitize object for logging - redact sensitive + PII fields.
 * @param {Object} obj - Any object
 * @returns {Object} Copy with sensitive values redacted
 */
function sanitizeForLog(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const keyLower = String(k).toLowerCase();
    const isSensitive = ALL_REDACT_KEYS.some(s => keyLower.includes(s.toLowerCase()));
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

/**
 * Safe request-body log. Use instead of JSON.stringify(req.body) on PII/payment endpoints.
 * Always sanitizes; in production omits body unless LOG_PII_DEBUG=1.
 */
function safeLogRequestBody(label, req, extra = {}) {
  const body = (req && req.body) ? { ...req.body, ...extra } : extra;
  const sanitized = sanitizeForLog(body);
  if (process.env.NODE_ENV === 'production' && process.env.LOG_PII_DEBUG !== '1') {
    console.log(label);
    return;
  }
  console.log(label, JSON.stringify(sanitized, null, 2));
}

/**
 * Safe headers log. Never log authorization, cookie, or other auth headers.
 * In production omits details unless LOG_PII_DEBUG=1.
 */
function safeLogHeaders(label, req) {
  if (!req || !req.headers) return;
  const sanitized = sanitizeForLog(req.headers);
  if (process.env.NODE_ENV === 'production' && process.env.LOG_PII_DEBUG !== '1') {
    console.log(label);
    return;
  }
  console.log(label, JSON.stringify(sanitized, null, 2));
}

/**
 * Sanitize error message for user-facing display (orch-14).
 * Prevents leaking internal paths, stack traces, or sensitive details.
 */
function sanitizeErrorMessage(msg, fallback = 'Something went wrong. Please try again.') {
  if (!msg || typeof msg !== 'string') return fallback;
  const s = msg.trim();
  if (!s) return fallback;
  // Block stack traces (at Module., at Object., at process.)
  if (/\bat\s+(?:Module\.|Object\.|process\.|node:)/i.test(s)) return fallback;
  // Block file paths (absolute or with node_modules)
  if (/^(?:\/|\\|[A-Z]:\\)/i.test(s) || s.includes('node_modules') || s.includes('__dirname')) return fallback;
  // Block internal error codes that expose implementation
  if (/\b(?:EADDRINUSE|ECONNREFUSED|ENOENT|ETIMEDOUT|ENOTFOUND)\b/i.test(s)) return fallback;
  if (s.length > 200) return fallback;
  return s;
}

module.exports = {
  sanitizeForLog,
  sanitizeErrorMessage,
  safeLogPayment,
  safeLogRequestBody,
  safeLogHeaders,
  hasCredential,
  PCI_SCOPE,
  PII_KEYS
};
