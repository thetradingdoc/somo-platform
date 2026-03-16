/**
 * Telemedicine Phase 3 — Task 20: HMAC-signed upload token.
 * Token format: base64url(hmac) + '.' + base64url(payload).
 * Payload = { patient_id, appointment_id, expires_at } (expires_at as ISO string).
 * Not a plain UUID; verifiable with UPLOAD_TOKEN_SECRET.
 */
const crypto = require('crypto');

const SECRET = process.env.UPLOAD_TOKEN_SECRET || 'change-me-in-production';

function base64url(buf) {
  return Buffer.isBuffer(buf) ? buf.toString('base64url') : Buffer.from(JSON.stringify(buf)).toString('base64url');
}

function decodeBase64url(str) {
  try {
    return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Create an HMAC-signed token for the upload portal.
 * @param {string} patientId - FHIR patient resource_id
 * @param {string|null} appointmentId - Optional appointment id (use 'none' or null for pre-booking)
 * @param {Date|string} expiresAt - Expiry time (Date or ISO string)
 * @returns {string} Token string (base64url.hmac.base64url.payload)
 */
function createUploadToken(patientId, appointmentId, expiresAt) {
  const exp = expiresAt instanceof Date ? expiresAt.toISOString() : (expiresAt || new Date(Date.now() + 3600000).toISOString());
  const payload = { patient_id: patientId, appointment_id: appointmentId || 'none', expires_at: exp };
  const payloadB64 = base64url(payload);
  const hmac = crypto.createHmac('sha256', SECRET).update(payloadB64).digest();
  const hmacB64 = base64url(hmac);
  return `${hmacB64}.${payloadB64}`;
}

/**
 * Verify token and return payload if valid.
 * @param {string} token - Token from query string
 * @returns {{ patient_id: string, appointment_id: string|null, expires_at: string }|null} Payload or null if invalid/expired
 */
function verifyUploadToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [hmacB64, payloadB64] = parts;
  const payload = decodeBase64url(payloadB64);
  if (!payload || !payload.patient_id || !payload.expires_at) return null;
  const expectedHmac = crypto.createHmac('sha256', SECRET).update(payloadB64).digest();
  const expectedB64 = base64url(expectedHmac);
  if (expectedB64 !== hmacB64) return null;
  const expiresAt = new Date(payload.expires_at).getTime();
  if (Date.now() > expiresAt) return null;
  return {
    patient_id: payload.patient_id,
    appointment_id: payload.appointment_id === 'none' ? null : payload.appointment_id,
    expires_at: payload.expires_at
  };
}

module.exports = { createUploadToken, verifyUploadToken, base64url, decodeBase64url };
