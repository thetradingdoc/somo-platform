'use strict';

const path = require('path');
const fs = require('fs');

function getHostname(req) {
  const host = req.headers.host;
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) return host.slice(1, end);
  }
  const idx = host.lastIndexOf(':');
  if (idx > 0 && !host.includes(']')) return host.slice(0, idx);
  return host;
}

function isSomoMarketingHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'callsomo.com' || h === 'www.callsomo.com';
}

function isLocalDevRootHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  if (isProd) return false;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(h);
}

/** Unified-dashboard portal static prefixes (must not receive SPA index.html). */
function isUnifiedDashboardAssetPath(p) {
  return (
    p.startsWith('/assets/js') ||
    p.startsWith('/assets/css') ||
    p.startsWith('/assets/images') ||
    p.startsWith('/assets/data') ||
    p.startsWith('/business/assets')
  );
}

function isSomoLandingApiPath(p) {
  return (
    p.startsWith('/api') ||
    p.startsWith('/fhir') ||
    p.startsWith('/voice') ||
    p.startsWith('/webhooks') ||
    p.startsWith('/health') ||
    p.startsWith('/signup') ||
    p.startsWith('/login') ||
    p.startsWith('/docs') ||
    p.startsWith('/terms') ||
    p.startsWith('/verify-card') ||
    p.startsWith('/reset-password') ||
    p.startsWith('/patients') ||
    p.startsWith('/business') ||
    p.startsWith('/admin') ||
    p.startsWith('/unified-dashboard') ||
    isUnifiedDashboardAssetPath(p)
  );
}

function createStaticPathHelpers(rootDir) {
  function getUnifiedDashboardPath(...subPaths) {
    let azurePath = path.join(rootDir, 'unified-dashboard', ...subPaths);
    if (fs.existsSync(azurePath)) {
      return azurePath;
    }
    return path.join(rootDir, '..', 'unified-dashboard', ...subPaths);
  }

  return { getUnifiedDashboardPath };
}

module.exports = {
  createStaticPathHelpers,
  getHostname,
  isSomoMarketingHostname,
  isLocalDevRootHost,
  isUnifiedDashboardAssetPath,
  isSomoLandingApiPath,
};
