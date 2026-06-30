'use strict';

const path = require('path');
const fs = require('fs');

function getHealthVideoSpaDir(rootDir) {
  const candidates = [
    path.join(rootDir, '..', 'unified-dashboard', 'health-video-landing', 'dist'),
    path.join(rootDir, 'unified-dashboard', 'health-video-landing', 'dist')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

function redirectHealthVideoEntry(res, rootDir) {
  if (getHealthVideoSpaDir(rootDir)) return res.redirect(302, '/health-video/');
  return res.redirect(302, '/health-video.html');
}

/**
 * Mount consumer health SPA and static terms/privacy pages.
 */
function registerHealthUi(app, { express, getUnifiedDashboardPath, rootDir = __dirname }) {
  const spaDir = getHealthVideoSpaDir(path.join(rootDir, '..'));

  if (process.env.LOCAL_DEV_ROOT === 'health') {
    app.get('/business/trial-activation.html', (req, res) => {
      redirectHealthVideoEntry(res, path.join(rootDir, '..'));
    });
  }

  if (spaDir) {
    app.use('/health-video', express.static(spaDir, { index: 'index.html' }));
    app.get('/health-video/*', (req, res) => {
      res.sendFile(path.join(spaDir, 'index.html'));
    });
  }

  app.get('/health-video.html', (req, res) => {
    if (spaDir) return res.redirect(302, '/health-video/');
    res.sendFile(getUnifiedDashboardPath('health-video.html'));
  });
  app.get('/health-terms.html', (req, res) => {
    res.sendFile(getUnifiedDashboardPath('health-terms.html'));
  });
  app.get('/health-privacy.html', (req, res) => {
    res.sendFile(getUnifiedDashboardPath('health-privacy.html'));
  });

  return { getHealthVideoSpaDir: () => getHealthVideoSpaDir(path.join(rootDir, '..')), redirectHealthVideoEntry: (res) => redirectHealthVideoEntry(res, path.join(rootDir, '..')) };
}

module.exports = {
  registerHealthUi,
  getHealthVideoSpaDir
};
