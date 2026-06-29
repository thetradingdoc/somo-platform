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

function mountCommerceLegacy(app, { publicCommerceLimiter, isCommerceLegacyEnabled }) {
  if (!isCommerceLegacyEnabled()) return;

  const publicCommerceQuoteRoutes = require('./public-commerce-quote');
  const publicCommerceCartRoutes = require('./public-commerce-cart');
  app.use('/api/public/commerce', publicCommerceLimiter);
  app.use('/api/public/commerce', publicCommerceQuoteRoutes);
  app.use('/api/public/commerce', publicCommerceCartRoutes);
  app.use('/public/commerce', publicCommerceLimiter);
  app.use('/public/commerce', publicCommerceQuoteRoutes);
  app.use('/public/commerce', publicCommerceCartRoutes);

  const publicCheckoutChatRoutes = require('./public-checkout-chat');
  app.use('/api/public/checkout-chat', publicCheckoutChatRoutes);
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
function mountAllRoutes(app, deps = {}) {
  mountHealthSpine(app);
  mountCommerceLegacy(app, deps);
  // Voice/RCM/admin mounts remain in server.js until Phase 3 extraction completes.
}

module.exports = {
  mountHealthSpine,
  mountCommerceLegacy,
  mountVoiceRoutes,
  mountRcmRoutes,
  mountAdminRoutes,
  mountAllRoutes
};
