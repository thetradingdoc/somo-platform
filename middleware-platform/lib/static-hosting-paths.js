'use strict';

const path = require('path');
const fs = require('fs');

function createStaticPathHelpers(rootDir) {
  function getUnifiedDashboardPath(...subPaths) {
    let azurePath = path.join(rootDir, 'unified-dashboard', ...subPaths);
    if (fs.existsSync(azurePath)) {
      return azurePath;
    }
    return path.join(rootDir, '..', 'unified-dashboard', ...subPaths);
  }

  function getLittleLabBuildPath(...subPaths) {
    let azurePath = path.join(rootDir, 'unified-dashboard', 'littlelab-landing', 'build', ...subPaths);
    if (fs.existsSync(azurePath)) {
      return azurePath;
    }
    return path.join(rootDir, '..', 'unified-dashboard', 'littlelab-landing', 'build', ...subPaths);
  }

  function trySendCanonicalLanding(res) {
    const landingBuild = getLittleLabBuildPath('index.html');
    if (fs.existsSync(landingBuild)) {
      return res.sendFile(landingBuild);
    }
    const sourceLandingPath = getUnifiedDashboardPath('littlelab-landing', 'public', 'index.html');
    if (fs.existsSync(sourceLandingPath)) {
      return res.sendFile(sourceLandingPath);
    }
    return false;
  }

  function sendLittleLabOrApiRunningStub(res) {
    if (trySendCanonicalLanding(res)) return;
    res.status(503).type('html').send(
      '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem">' +
      '<h1>Skin &amp; Care</h1><p>Landing build not found. Run:</p>' +
      '<pre style="background:#f4f4f5;padding:1rem;border-radius:8px;overflow:auto">cd unified-dashboard/littlelab-landing && npm install && npm run build</pre>' +
      '</body></html>'
    );
  }

  return {
    getUnifiedDashboardPath,
    getLittleLabBuildPath,
    trySendCanonicalLanding,
    sendLittleLabOrApiRunningStub,
  };
}

module.exports = { createStaticPathHelpers };
