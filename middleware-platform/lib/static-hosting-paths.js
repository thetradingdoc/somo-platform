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
    h === 'callsomo.com' ||
    h === 'www.callsomo.com' ||
    h === 'skinandcare.com' ||
    h === 'www.skinandcare.com' ||
    h === 'callsomo.com' ||
    h === 'www.callsomo.com'
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

/** Unified-dashboard portal static prefixes (must not receive landing SPA index.html). */
function isUnifiedDashboardAssetPath(p) {
  return (
    p.startsWith('/assets/js') ||
    p.startsWith('/assets/css') ||
    p.startsWith('/assets/images') ||
    p.startsWith('/assets/data') ||
    p.startsWith('/business/assets')
  );
}

const SOMO_LANDING_BUILD_INSTRUCTIONS_HTML =
  '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem">' +
  '<h1>Somo</h1><p>Landing build not found or out of date. Run:</p>' +
  '<pre style="background:#f4f4f5;padding:1rem;border-radius:8px;overflow:auto">cd middleware-platform && npm run build:somo-landing</pre>' +
  '<p>Or restart with <code>npm start</code> (runs prestart build check).</p>' +
  '</body></html>';

function parseLandingMainBundleSrc(html) {
  const m = String(html).match(
    /<script[^>]+type=["']module["'][^>]+src=["'](\/assets\/index-[^"']+\.js)["']/i
  );
  if (m) return m[1];
  const m2 = String(html).match(/src=["'](\/assets\/index-[^"']+\.js)["']/i);
  return m2 ? m2[1] : null;
}

/** True when build/index.html exists and its hashed JS bundle is on disk (not dev /src/main.jsx). */
function isSomoLandingBuildReady(getSomoLandingBuildPath) {
  const indexPath = getSomoLandingBuildPath('index.html');
  if (!fs.existsSync(indexPath)) return false;
  const html = fs.readFileSync(indexPath, 'utf8');
  const src = parseLandingMainBundleSrc(html);
  if (!src || src.includes('/src/')) return false;
  const bundlePath = getSomoLandingBuildPath(src.replace(/^\//, ''));
  return fs.existsSync(bundlePath) && fs.statSync(bundlePath).isFile();
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

  function getSomoLandingBuildPath(...subPaths) {
    let azurePath = path.join(rootDir, 'unified-dashboard', 'somo-landing', 'build', ...subPaths);
    if (fs.existsSync(azurePath)) {
      return azurePath;
    }
    return path.join(rootDir, '..', 'unified-dashboard', 'somo-landing', 'build', ...subPaths);
  }

  function trySendSomoLanding(res) {
    if (!isSomoLandingBuildReady(getSomoLandingBuildPath)) return false;
    return res.sendFile(path.resolve(getSomoLandingBuildPath('index.html')));
  }

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
  isUnifiedDashboardAssetPath,
  isSomoLandingApiPath,
  SOMO_LANDING_BUILD_INSTRUCTIONS_HTML,
  parseLandingMainBundleSrc,
  isSomoLandingBuildReady,
};
