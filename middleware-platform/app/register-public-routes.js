'use strict';

/**
 * Public / content API routes (RAG, video consult, landing funnel).
 * Extracted from server.js (RS-2-04).
 */
function registerPublicContentRoutes(app, deps) {
  const { apiLimiter, publicCatalogReadLimiter, publicCommerceLimiter } = deps;

  const ragProxyRoutes = require('../routes/rag-proxy');
  const ragSearchRoutes = require('../routes/rag-search');
  app.use('/api/rag', ragProxyRoutes);
  app.use('/api/rag', ragSearchRoutes);

  const videoConsultRoutes = require('../routes/video-consult');
  app.use('/api/video-consult', videoConsultRoutes);

  const { registerFaceReadPublicRoute } = require('../routes/public/public-face-read');
  registerFaceReadPublicRoute(app, { apiLimiter });

  const { registerPublicRoutineRoutes } = require('../routes/public/public-routines');
  registerPublicRoutineRoutes(app, { apiLimiter });

  const { registerPublicFunnelMatchRoutes } = require('../routes/public/public-funnel-match');
  registerPublicFunnelMatchRoutes(app, { apiLimiter });

  const { registerPublicFunnelIntakeRoutes } = require('../routes/public/public-funnel-intake');
  registerPublicFunnelIntakeRoutes(app, { apiLimiter });

  const { registerPublicFunnelSpecialistRoutes } = require('../routes/public/public-funnel-specialists');
  registerPublicFunnelSpecialistRoutes(app, { apiLimiter });

  // landing-assistant routes registered in register-patient-routes.js (needs express, db, etc.)

  const { registerPublicProductScanRoutes } = require('../routes/public/public-product-scan');
  registerPublicProductScanRoutes(app, { apiLimiter });

  // Legacy consumer redirect
  app.get(/^\/consumer(\/.*)?$/, (req, res) => {
    const sub = String(req.path || '').replace(/^\/consumer\/?/, '');
    if (sub.includes('get-app') || sub.includes('join')) {
      return res.redirect(302, '/patients/patient-login.html?intent=signup');
    }
    return res.redirect(302, '/start');
  });

  const publicProductsRoutes = require('../routes/public/public-products');
  app.use('/api/public/products', publicCatalogReadLimiter, publicProductsRoutes);
  app.use('/api/public/prescriptions', publicCatalogReadLimiter, publicProductsRoutes);
  app.use('/public/products', publicCatalogReadLimiter, publicProductsRoutes);
  app.use('/public/prescriptions', publicCatalogReadLimiter, publicProductsRoutes);

  const publicPlanSearchRoutes = require('../routes/public/public-plan-search');
  app.use('/api/public/plans', publicCatalogReadLimiter, publicPlanSearchRoutes);

  const publicGeoRoutes = require('../routes/public/public-geo');
  app.use('/api/public/geo', publicCatalogReadLimiter, publicGeoRoutes);

  const publicProviderSearchRoutes = require('../routes/public/public-provider-search');
  app.use('/api/public/providers', publicCatalogReadLimiter, publicProviderSearchRoutes);

  const publicCheckoutRoutes = require('../routes/public/public-checkout');
  app.use('/api/public/checkout', publicCheckoutRoutes);

  if (process.env.FEATURE_AGENTIC_CHECKOUT === '0') {
    const disabled = (_req, res) => res.status(410).json({ error: 'legacy_commerce_disabled' });
    app.use('/api/public/commerce', disabled);
    app.use('/public/commerce', disabled);
  } else {
    app.use('/api/public/commerce', (req, _res, next) => {
      if (process.env.COMMERCE_TELEMETRY === '1') {
        console.log('[commerce-telemetry]', req.method, req.originalUrl);
      }
      next();
    });
    const publicCommerceQuoteRoutes = require('../routes/public/public-commerce-quote');
    const publicCommerceCartRoutes = require('../routes/public/public-commerce-cart');
    app.use('/api/public/commerce', publicCommerceLimiter);
    app.use('/api/public/commerce', publicCommerceQuoteRoutes);
    app.use('/api/public/commerce', publicCommerceCartRoutes);
    app.use('/public/commerce', publicCommerceLimiter);
    app.use('/public/commerce', publicCommerceQuoteRoutes);
    app.use('/public/commerce', publicCommerceCartRoutes);
  }

  const publicCheckoutChatRoutes = require('../routes/public/public-checkout-chat');
  app.use('/api/public/checkout-chat', publicCheckoutChatRoutes);
}

module.exports = { registerPublicContentRoutes };
