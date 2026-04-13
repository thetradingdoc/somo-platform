'use strict';

const crypto = require('crypto');
const twilio = require('twilio');
const db = require('../database');

function getPublicUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}${req.originalUrl}`;
}

function twilioSignatureRequired(req, res, next) {
  const raw = String(process.env.TWILIO_WEBHOOK_SIGNATURE_REQUIRED || '').toLowerCase().trim();
  const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  // Default-on in production unless explicitly disabled.
  const enforce = raw ? (raw === '1' || raw === 'true') : isProd;
  if (!enforce) return next();

  try {
    const token = process.env.TWILIO_AUTH_TOKEN;
    const signature = req.headers['x-twilio-signature'];
    if (!token || !signature) {
      return res.status(401).json({ success: false, error: 'twilio_signature_missing' });
    }
    const url = getPublicUrl(req);
    const valid = twilio.validateRequest(token, String(signature), url, req.body || {});
    if (!valid) {
      return res.status(401).json({ success: false, error: 'twilio_signature_invalid' });
    }
    return next();
  } catch (e) {
    console.warn('[WebhookSecurity] twilio signature validation error:', e.message);
    return res.status(401).json({ success: false, error: 'twilio_signature_invalid' });
  }
}

function replayGuard({ source, ttlMinutes = 30, keyBuilder }) {
  const op = `replay:${String(source || 'unknown')}`;
  const ttl = Math.max(1, Number(ttlMinutes || 30));
  return (req, res, next) => {
    try {
      const replayKey = String(keyBuilder(req) || '').trim();
      if (!replayKey) return next();

      const hashed = crypto.createHash('sha256').update(replayKey).digest('hex');
      const existing = db.db.prepare(`
        SELECT status FROM idempotency_keys
        WHERE id = ? AND operation_type = ?
          AND datetime(created_at) > datetime('now', ?)
        LIMIT 1
      `).get(hashed, op, `-${ttl} minutes`);
      if (existing) {
        return res.status(200).json({ success: true, received: true, replay_skipped: true });
      }
      db.db.prepare(`
        INSERT OR REPLACE INTO idempotency_keys (id, operation_type, status, created_at)
        VALUES (?, ?, 'completed', datetime('now'))
      `).run(hashed, op);
    } catch (e) {
      console.warn('[WebhookSecurity] replayGuard error:', e.message);
    }
    return next();
  };
}

module.exports = {
  twilioSignatureRequired,
  replayGuard
};

