'use strict';

const path = require('path');
const fs = require('fs');

const {
  createStaticPathHelpers,
  getHostname,
  isSomoMarketingHostname,
  isLocalDevRootHost,
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
 */
function registerStaticHosting(app, { express, rootDir }) {
  const { getUnifiedDashboardPath } = createStaticPathHelpers(rootDir);

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
  app.use('/business/assets', express.static(getUnifiedDashboardPath('assets'), { maxAge: '1d' }));

  return { getUnifiedDashboardPath };
}

/**
 * Serve unified-dashboard /assets before the global middleware stack on marketing hosts.
 */
function registerEarlySomoLandingStatic(app, { express, rootDir }) {
  const { getUnifiedDashboardPath } = createStaticPathHelpers(rootDir);

  function trySendBuildFile(res, filePath) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    res.sendFile(path.resolve(filePath));
    return true;
  }

  function trySendUnifiedDashboardAsset(req, res) {
    if (!req.path.startsWith('/assets/')) return false;
    const rel = req.path.replace(/^\/assets\//, '');
    if (!rel || rel.includes('..')) return false;
    return trySendBuildFile(res, getUnifiedDashboardPath('assets', rel));
  }

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!isSomoMarketingHostname(getHostname(req)) && !isLocalDevRootHost(getHostname(req))) return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/voice') || req.path.startsWith('/business')) {
      return next();
    }
    if (trySendUnifiedDashboardAsset(req, res)) return;
    if (isUnifiedDashboardAssetPath(req.path)) return next();
    if (req.path === '/' || req.path === '') {
      const root = String(process.env.LOCAL_DEV_ROOT || '').trim();
      if (root === 'login') return res.redirect(302, '/login');
      if (root === 'signup') return res.redirect(302, '/signup');
      if (root === 'health') return redirectHealthVideoEntry(res);
      if (root === 'stub') {
        return res.type('text/html').send(
          '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem">' +
          '<p>Middleware API is running.</p>' +
          '<p><a href="/">Somo landing</a></p>' +
          '</body></html>'
        );
      }
      return res.redirect(302, '/business/trial-activation.html');
    }
    if (
      process.env.LOCAL_DEV_ROOT === 'health' &&
      (req.path === '/business/trial-activation.html' || req.path === '/business/trial-activation')
    ) {
      return redirectHealthVideoEntry(res);
    }
    next();
  });
}

function redirectHealthVideoEntry(res) {
  const pathMod = require('path');
  const fsMod = require('fs');
  const candidates = [
    pathMod.join(__dirname, '..', '..', 'unified-dashboard', 'health-video-landing', 'dist'),
    pathMod.join(__dirname, '..', 'unified-dashboard', 'health-video-landing', 'dist')
  ];
  for (const dir of candidates) {
    if (fsMod.existsSync(pathMod.join(dir, 'index.html'))) {
      return res.redirect(302, '/health-video/');
    }
  }
  return res.redirect(302, '/health-video.html');
}

module.exports = { registerStaticHosting, registerEarlySomoLandingStatic, LEGACY_LANDING_REDIRECT_PREFIXES };
