'use strict';

const fs = require('fs');
const path = require('path');

const {
  createStaticPathHelpers,
  getHostname,
  shouldServeSomoLanding,
  isSomoLandingApiPath,
  isUnifiedDashboardAssetPath,
  isSomoLandingBuildReady,
  SOMO_LANDING_BUILD_INSTRUCTIONS_HTML,
} = require('../lib/static-hosting-paths');

/** Legacy littlelab SPA paths — redirect to / in server.js route handlers. */
const LEGACY_LANDING_REDIRECT_PREFIXES = [
  '/start',
  '/find-provider',
  '/about',
  '/shop',
  '/products',
  '/cart',
  '/checkout',
  '/coverage',
  '/landing',
  '/landing.html',
  '/how-it-works',
  '/skin-care',
];

/**
 * Mount shared static assets for unified-dashboard HTML portals.
 * Somo marketing SPA shell is served from server.js host-based routes.
 */
function registerStaticHosting(app, { express, rootDir }) {
  const {
    getUnifiedDashboardPath,
    getSomoLandingBuildPath,
  } = createStaticPathHelpers(rootDir);

  app.use('/unified-dashboard', express.static(getUnifiedDashboardPath(), {
    index: false,
    extensions: ['html'],
    maxAge: '5m',
  }));

  app.get('/manifest.webmanifest', (req, res) => {
    const manifestPath = getUnifiedDashboardPath('manifest.webmanifest');
    if (require('fs').existsSync(manifestPath)) {
      res.type('application/manifest+json');
      res.sendFile(manifestPath);
    } else {
      res.status(404).json({ error: 'Manifest not found' });
    }
  });

  app.use('/assets', express.static(getUnifiedDashboardPath('assets'), { maxAge: '1d' }));
  // Provider pages under /business/ sometimes resolve ../assets to /business/assets — alias to shared assets.
  app.use('/business/assets', express.static(getUnifiedDashboardPath('assets'), { maxAge: '1d' }));

  const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  app.use('/somo-landing-assets', express.static(getSomoLandingBuildPath('assets'), {
    maxAge: isProd ? '1y' : 0,
    immutable: isProd,
  }));

  return {
    getUnifiedDashboardPath,
    getSomoLandingBuildPath,
  };
}

/**
 * Serve Somo marketing static files before the heavy global middleware stack.
 * GET/HEAD only; API and portal paths pass through.
 */
function registerEarlySomoLandingStatic(app, { express, rootDir }) {
  const { getSomoLandingBuildPath, getUnifiedDashboardPath } = createStaticPathHelpers(rootDir);

  const STATIC_EXT = /\.(js|mjs|css|json|woff2?|png|jpe?g|gif|svg|ico|webp)$/i;

  function trySendBuildFile(res, filePath) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    res.sendFile(path.resolve(filePath));
    return true;
  }

  function trySendLandingBuildAsset(req, res) {
    if (!req.path.startsWith('/assets/')) return false;
    const rel = req.path.replace(/^\//, '');
    if (!rel || rel.includes('..')) return false;
    return trySendBuildFile(res, getSomoLandingBuildPath(rel));
  }

  /** Signup/portal files under /assets that are not in the landing Vite build. */
  function trySendUnifiedDashboardAsset(req, res) {
    if (!req.path.startsWith('/assets/')) return false;
    const rel = req.path.replace(/^\/assets\//, '');
    if (!rel || rel.includes('..')) return false;
    return trySendBuildFile(res, getUnifiedDashboardPath('assets', rel));
  }

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!shouldServeSomoLanding(getHostname(req))) return next();
    if (isSomoLandingApiPath(req.path)) return next();

    // Landing build wins for shared /assets/* paths (e.g. hero-phone-v2.jpg lives only in somo-landing/build).
    if (trySendLandingBuildAsset(req, res)) return;
    if (trySendUnifiedDashboardAsset(req, res)) return;

    // Portal asset URLs must not fall through to landing SPA index.html.
    if (isUnifiedDashboardAssetPath(req.path)) return next();

    // Hashed Vite assets (/assets/index-*.css|js) — never SPA-fallback to index.html.
    if (req.path.startsWith('/assets/')) {
      if (STATIC_EXT.test(req.path) && !res.headersSent) {
        res.status(404).end();
      }
      return;
    }

    // SPA document routes (/, /about, etc.)
    if (isSomoLandingBuildReady(getSomoLandingBuildPath)) {
      res.sendFile(path.resolve(getSomoLandingBuildPath('index.html')));
      return;
    }
    if (!STATIC_EXT.test(req.path) && !res.headersSent) {
      res.status(503).type('html').send(SOMO_LANDING_BUILD_INSTRUCTIONS_HTML);
    }
  });
}

module.exports = { registerStaticHosting, registerEarlySomoLandingStatic, LEGACY_LANDING_REDIRECT_PREFIXES };
