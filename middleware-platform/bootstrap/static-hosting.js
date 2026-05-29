'use strict';

const { createStaticPathHelpers } = require('../lib/static-hosting-paths');

const LITTLELAB_SPA_PREFIXES = [
  '/start',
  '/find-provider',
  '/about',
  '/shop',
  '/products',
  '/cart',
  '/checkout',
  '/coverage',
];

/**
 * Mount shared static assets and SPA shells (helpers remain in server.js for host-based HTML routes).
 */
function registerStaticHosting(app, { express, rootDir, skipLittleLabSpa }) {
  const {
    getUnifiedDashboardPath,
    getLittleLabBuildPath,
    getDodgecallBuildPath,
    sendLittleLabOrApiRunningStub,
  } = createStaticPathHelpers(rootDir);

  function serveLittleLabSpaGetHead(req, res, next) {
    if (skipLittleLabSpa && skipLittleLabSpa(req)) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    sendLittleLabOrApiRunningStub(res);
  }

  for (const spaPrefix of LITTLELAB_SPA_PREFIXES) {
    app.use(spaPrefix, serveLittleLabSpaGetHead);
  }

  app.use('/unified-dashboard', express.static(getUnifiedDashboardPath(), {
    index: false,
    extensions: ['html'],
    maxAge: '5m',
  }));

  app.use('/littlelab-landing', express.static(getUnifiedDashboardPath('littlelab-landing'), {
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

  const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  app.use('/static', express.static(getLittleLabBuildPath('static'), {
    maxAge: isProd ? '1y' : 0,
    immutable: isProd,
  }));
  app.use('/images', express.static(getLittleLabBuildPath('images'), { maxAge: '1d' }));
  app.use('/videos', express.static(getLittleLabBuildPath('videos'), { maxAge: '1d' }));
  app.use('/fonts', express.static(getLittleLabBuildPath('fonts'), {
    maxAge: '1d',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.css')) res.type('text/css');
    },
  }));
  app.use('/fonts', express.static(getUnifiedDashboardPath('littlelab-landing', 'public', 'fonts'), {
    maxAge: '1d',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.css')) res.type('text/css');
    },
  }));

  app.use('/dodgecall-assets', express.static(getDodgecallBuildPath('assets'), {
    maxAge: isProd ? '1y' : 0,
    immutable: isProd,
  }));

  return {
    getUnifiedDashboardPath,
    getLittleLabBuildPath,
    getDodgecallBuildPath,
    sendLittleLabOrApiRunningStub,
  };
}

module.exports = { registerStaticHosting, LITTLELAB_SPA_PREFIXES };
