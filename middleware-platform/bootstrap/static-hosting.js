'use strict';

const fs = require('fs');
const path = require('path');

const {
  createStaticPathHelpers,
  getHostname,
  shouldServeSomoLanding,
  isSomoLandingApiPath,
  isUnifiedDashboardAssetPath,
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

  /** Signup/portal files under /assets that are not in the landing Vite build. */
  function trySendUnifiedDashboardAsset(req, res) {
    if (!req.path.startsWith('/assets/')) return false;
    const rel = req.path.replace(/^\/assets\//, '');
    if (!rel || rel.includes('..')) return false;
    const filePath = getUnifiedDashboardPath('assets', rel);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    return res.sendFile(path.resolve(filePath));
  }

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!shouldServeSomoLanding(getHostname(req))) return next();
    if (isSomoLandingApiPath(req.path)) return next();

    if (trySendUnifiedDashboardAsset(req, res)) return;

    // Portal asset URLs must not fall through to landing SPA index.html.
    if (isUnifiedDashboardAssetPath(req.path)) return next();

    return express.static(getSomoLandingBuildPath(), { index: false, maxAge: '5m' })(req, res, () => {
      if ((req.method === 'GET' || req.method === 'HEAD') && !res.headersSent) {
        if (/\.(js|mjs|css|json|woff2?|png|jpe?g|gif|svg|ico|webp)$/i.test(req.path)) {
          return next();
        }
        const indexPath = getSomoLandingBuildPath('index.html');
        if (require('fs').existsSync(indexPath)) {
          return res.sendFile(indexPath);
        }
      }
      return next();
    });
  });
}

module.exports = { registerStaticHosting, registerEarlySomoLandingStatic, LEGACY_LANDING_REDIRECT_PREFIXES };
