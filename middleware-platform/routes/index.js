'use strict';

/**
 * Route mount registry — health spine first. Add domains here; keep server.js thin.
 */
function mountHealthSpine(app) {
  const healthSessionRoutes = require('./health-session');
  app.use('/api/health-session', healthSessionRoutes);

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

module.exports = {
  mountHealthSpine,
  mountCommerceLegacy
};
