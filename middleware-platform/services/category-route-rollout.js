'use strict';

const crypto = require('crypto');

function parsePercent(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function pickStableBucket(key) {
  const src = String(key || '');
  const digest = crypto.createHash('sha1').update(src).digest('hex');
  const sample = parseInt(digest.slice(0, 8), 16);
  return sample % 100;
}

function shouldUseCanary(key, percent) {
  const p = parsePercent(percent, 0);
  if (p <= 0) return false;
  return pickStableBucket(key) < p;
}

function rolloutConfig() {
  return {
    primaryMapFile: process.env.CATEGORY_ROUTE_MAP_FILE || null,
    shadowMapFile: process.env.CATEGORY_ROUTE_SHADOW_MAP_FILE || null,
    canaryPercent: parsePercent(process.env.CATEGORY_ROUTE_CANARY_PERCENT || 0, 0),
    mode: String(process.env.CATEGORY_ROUTE_MODE || 'normal').trim().toLowerCase() || 'normal'
  };
}

module.exports = {
  rolloutConfig,
  shouldUseCanary,
  parsePercent
};
