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
  return (
    h === 'myskinandcare.com' ||
    h === 'www.myskinandcare.com' ||
    h === 'skinandcare.com' ||
    h === 'www.skinandcare.com' ||
    h === 'dodgecall.app' ||
    h === 'www.dodgecall.app'
  );
}

function isLocalDevRootHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  if (isProd) return false;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(h);
}

function shouldServeSomoLanding(hostname) {
  return isSomoMarketingHostname(hostname) || isLocalDevRootHost(hostname);
}

function isSomoLandingApiPath(p) {
  return (
    p.startsWith('/api') ||
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
    p.startsWith('/unified-dashboard')
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

  function getSomoLandingBuildPath(...subPaths) {
    let azurePath = path.join(rootDir, 'unified-dashboard', 'somo-landing', 'build', ...subPaths);
    if (fs.existsSync(azurePath)) {
      return azurePath;
    }
    return path.join(rootDir, '..', 'unified-dashboard', 'somo-landing', 'build', ...subPaths);
  }

  function trySendSomoLanding(res) {
    const landingBuild = getSomoLandingBuildPath('index.html');
    if (fs.existsSync(landingBuild)) {
      return res.sendFile(path.resolve(landingBuild));
    }
    return false;
  }

  const SOMO_LANDING_BUILD_INSTRUCTIONS_HTML =
    '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem">' +
    '<h1>Somo</h1><p>Landing build not found. Run:</p>' +
    '<pre style="background:#f4f4f5;padding:1rem;border-radius:8px;overflow:auto">cd unified-dashboard/somo-landing && npm install && npm run build</pre>' +
    '</body></html>';

  function sendSomoLandingOrInstructions(res) {
    if (trySendSomoLanding(res)) return;
    res.status(503).type('html').send(SOMO_LANDING_BUILD_INSTRUCTIONS_HTML);
  }

  return {
    getUnifiedDashboardPath,
    getSomoLandingBuildPath,
    trySendSomoLanding,
    sendSomoLandingOrInstructions,
  };
}

module.exports = {
  createStaticPathHelpers,
  getHostname,
  isSomoMarketingHostname,
  isLocalDevRootHost,
  shouldServeSomoLanding,
  isSomoLandingApiPath,
};
