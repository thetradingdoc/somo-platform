'use strict';

const db = require('../database');
const { hashToken } = require('../services/platform/secret-manager');

function parseScopes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) return p.map((x) => String(x).trim()).filter(Boolean);
  } catch (_) {}
  return [];
}

function requireServiceScope(requiredScope) {
  return (req, res, next) => {
    try {
      const auth = String(req.headers.authorization || '');
      if (!auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'missing_service_token' });
      }
      const token = auth.slice('Bearer '.length).trim();
      const tokenHash = hashToken(token);
      const cred = db.getServiceCredentialByTokenHash(tokenHash);
      if (!cred) {
        return res.status(403).json({ success: false, error: 'invalid_service_token' });
      }
      if (cred.expires_at && new Date(cred.expires_at).getTime() < Date.now()) {
        return res.status(403).json({ success: false, error: 'expired_service_token' });
      }
      const scopes = parseScopes(cred.scopes_json);
      if (!scopes.includes(requiredScope) && !scopes.includes('*')) {
        return res.status(403).json({ success: false, error: 'insufficient_scope', required_scope: requiredScope });
      }
      db.markServiceCredentialUsed(cred.id);
      req.serviceAuth = {
        credential_id: cred.id,
        service_name: cred.service_name,
        scopes
      };
      return next();
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message || 'service_auth_error' });
    }
  };
}

module.exports = {
  requireServiceScope
};

