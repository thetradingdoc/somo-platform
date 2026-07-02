'use strict';

const { encryptApiKey, decryptApiKey } = require('../../utils/api-keys');

const SECRET_KEYS = new Set([
  'client_secret',
  'api_key',
  'api_secret',
  'refresh_token',
  'access_token'
]);

function encryptPmsConfig(plain) {
  if (!plain || typeof plain !== 'object') return null;
  const copy = { ...plain };
  for (const key of Object.keys(copy)) {
    if (SECRET_KEYS.has(key) && copy[key]) {
      copy[key] = encryptApiKey(String(copy[key]));
    }
  }
  return JSON.stringify(copy);
}

function decryptPmsConfig(stored) {
  if (!stored) return {};
  let parsed;
  try {
    parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
  } catch (_) {
    return {};
  }
  const copy = { ...parsed };
  for (const key of Object.keys(copy)) {
    if (SECRET_KEYS.has(key) && copy[key] && String(copy[key]).includes(':')) {
      try {
        copy[key] = decryptApiKey(String(copy[key]));
      } catch (_) {
        /* leave as-is if not encrypted */
      }
    }
  }
  return copy;
}

function maskPmsConfigForApi(config = {}) {
  const out = { ...config };
  for (const key of Object.keys(out)) {
    if (SECRET_KEYS.has(key) && out[key]) {
      const s = String(out[key]);
      out[key] = s.length > 4 ? `${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : '****';
    }
  }
  return out;
}

module.exports = {
  encryptPmsConfig,
  decryptPmsConfig,
  maskPmsConfigForApi,
  SECRET_KEYS
};
