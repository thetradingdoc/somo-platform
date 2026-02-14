/**
 * Application Insights (Section 1 - Observability)
 *
 * Init with APPINSIGHTS_INSTRUMENTATIONKEY.
 * Auto-tracks HTTP requests, exceptions, dependencies.
 * Optional - no-op if key not set.
 */

let appInsights = null;

function init() {
  const key = process.env.APPINSIGHTS_INSTRUMENTATIONKEY;
  if (!key) {
    console.log('ℹ️  Application Insights: not configured (APPINSIGHTS_INSTRUMENTATIONKEY)');
    return;
  }
  try {
    appInsights = require('applicationinsights');
    appInsights.setup(key)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .start();
    console.log('✅ Application Insights enabled');
  } catch (e) {
    console.warn('⚠️  Application Insights init failed:', e.message);
  }
}

function getClient() {
  return appInsights && appInsights.defaultClient ? appInsights.defaultClient : null;
}

function trackRequest(req, res, durationMs, success = true) {
  const client = getClient();
  if (!client) return;
  try {
    client.trackRequest({
      name: `${req.method} ${req.path || req.url}`,
      url: req.originalUrl || req.url,
      duration: durationMs,
      resultCode: res.statusCode,
      success
    });
  } catch (_) { /* ignore */ }
}

module.exports = { init, getClient, trackRequest };
