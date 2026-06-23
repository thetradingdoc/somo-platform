'use strict';

/**
 * HTTP route registration (Phase 4 — incremental extraction from server.js).
 * Register domain route batches here as server.js is thinned.
 */

function registerCoreApiRoutes(app) {
  const signupRoutes = require('../routes/signup');
  app.use('/api', signupRoutes);

  const creditsRoutes = require('../routes/credits');
  app.use('/api/credits', creditsRoutes);

  const invoiceRoutes = require('../routes/invoices');
  app.use('/api', invoiceRoutes);

  const merchantRoutes = require('../routes/merchant');
  app.use('/api/merchant', merchantRoutes);

  const providerRoutes = require('../routes/providers');
  app.use('/api/providers', providerRoutes);
}

function registerCommerceApiRoutes(app) {
  const commerceDisabled = process.env.FEATURE_AGENTIC_CHECKOUT === '0';
  if (commerceDisabled) {
    const disabled = (_req, res) =>
      res.status(410).json({ error: 'legacy_commerce_disabled', message: 'Agentic checkout is retired.' });
    app.use('/api/public/commerce', disabled);
    app.use('/public/commerce', disabled);
  }

  const clinicInvoiceRoutes = require('../routes/invoices-clinic');
  app.use('/api/invoices', clinicInvoiceRoutes);

  const productRoutes = require('../routes/products');
  const orderRoutes = require('../routes/orders');
  const prescriptionRoutes = require('../routes/prescriptions');
  app.use('/api/products', productRoutes);
  app.use('/api/prescriptions', prescriptionRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/prescription-orders', orderRoutes);

  const onboardingRoutes = require('../routes/onboarding');
  app.use('/api/onboarding', onboardingRoutes);
}

function registerAdminApiRoutes(app) {
  const adminLeadsRoutes = require('../routes/admin/admin-leads');
  app.use('/api/admin/leads', adminLeadsRoutes);

  const adminScrapeRoutes = require('../routes/admin/admin-scrape');
  app.use('/api/admin/scrape', adminScrapeRoutes);

  const adminEnrichRoutes = require('../routes/admin/admin-enrich');
  app.use('/api/admin/enrich', adminEnrichRoutes);

  const sequencesRoutes = require('../routes/sequences');
  app.use('/api/sequences', sequencesRoutes);

  const workflowsRoutes = require('../routes/workflows');
  app.use('/api/admin/workflows', workflowsRoutes);

  const aiTemplatesRoutes = require('../routes/ai-templates');
  app.use('/api/ai/templates', aiTemplatesRoutes);

  const qualificationRulesRoutes = require('../routes/qualification-rules');
  app.use('/api/qualification-rules', qualificationRulesRoutes);

  const adminAIAssistantRoutes = require('../routes/admin/admin-ai-assistant');
  app.use('/api/admin/ai', adminAIAssistantRoutes);

  const adminTenantsRoutes = require('../routes/admin/admin-tenants');
  app.use('/api/admin/tenants', adminTenantsRoutes);

  const tenantConfigRoutes = require('../routes/tenant-config');
  app.use('/api/tenant', tenantConfigRoutes);
}

function registerVoiceRcmRoutes(app, { tenantContext }) {
  const retellFunctionsRoutes = require('../routes/voice/retell-functions');
  app.use('/api/retell', retellFunctionsRoutes);

  const voiceRoutes = require('../routes/voice/voice');
  app.use('/voice', tenantContext({ requireTenant: false }), voiceRoutes);

  const voiceAgentSettingsRoutes = require('../routes/voice-agent-settings');
  app.use('/api/voice-agent', tenantContext({ requireTenant: false }), voiceAgentSettingsRoutes);

  const voiceBillingRoutes = require('../routes/voice-billing');
  app.use('/api/voice-billing', voiceBillingRoutes);

  const outboundCallRoutes = require('../routes/outbound-call');
  app.use('/api/voice/outbound', outboundCallRoutes);

  const voiceWebCallRoutes = require('../routes/voice-web-call');
  app.use('/api/voice', voiceWebCallRoutes);

  const rcmRoutes = require('../routes/rcm/rcm');
  app.use('/api/rcm', rcmRoutes);

  const rcmPublicRoutes = require('../routes/rcm-public');
  app.use('/api/public/rcm', rcmPublicRoutes);
}

module.exports = {
  registerCoreApiRoutes,
  registerCommerceApiRoutes,
  registerAdminApiRoutes,
  registerVoiceRcmRoutes,
};
