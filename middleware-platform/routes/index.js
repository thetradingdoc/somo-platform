'use strict';

/**
 * Route mount registry — health spine first. Add domains here; keep server.js thin.
 */
function mountHealthSpine(app) {
  const healthSessionRoutes = require('./health-session');
  app.use('/api/health-session', healthSessionRoutes);

  const healthTransportRoutes = require('./health-transport');
  app.use('/api/health-session', healthTransportRoutes);

  const videoConsultRoutes = require('./video-consult');
  app.use('/api/video-consult', videoConsultRoutes);
}

function mountVoiceRoutes(app) {
  const voiceRoutes = require('./voice');
  app.use('/voice', voiceRoutes);
  app.use('/api/voice-agent', voiceRoutes);
}

function mountRcmRoutes(app) {
  const rcmRoutes = require('./rcm');
  app.use('/api/rcm', rcmRoutes);
}

function mountAdminRoutes(app) {
  const adminTenants = require('./admin-tenants');
  app.use('/api/admin', adminTenants);
}

/**
 * Central route registry — extend incrementally; server.js calls mountHealthSpine today.
 * Additional domains mount here as they migrate off server.js.
 */
function mountAllRoutes(app) {
  mountHealthSpine(app);
  // Voice/RCM/admin mounts remain in server.js until Phase 3 extraction completes.
}

module.exports = {
  mountHealthSpine,
  mountVoiceRoutes,
  mountRcmRoutes,
  mountAdminRoutes,
  mountAllRoutes
};
