/**
 * Application Insights (Section 1 - Observability)
 *
 * Init with APPINSIGHTS_INSTRUMENTATIONKEY.
 * Auto-tracks HTTP requests, exceptions, dependencies.
 * Optional - no-op if key not set.
 */

let appInsights = null;

function scrubObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const SENSITIVE_KEYS = [
    'authorization', 'cookie', 'set-cookie',
    'x-session-id', 'patient_session_id',
    'verification_code', 'code', 'otp',
    'token', 'payment_token',
    'email', 'phone', 'patient_email', 'patient_phone'
  ];
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.includes(lower) || lower.includes('token') || lower.includes('secret') || lower.includes('password')) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = scrubObject(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

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
    // mvp-77: PHI/PII scrubbing hook (best-effort)
    try {
      const client = appInsights.defaultClient;
      if (client && typeof client.addTelemetryProcessor === 'function') {
        client.addTelemetryProcessor((envelope) => {
          try {
            if (envelope && envelope.data && envelope.data.baseData) {
              const bd = envelope.data.baseData;
              if (bd.properties) bd.properties = scrubObject(bd.properties);
              if (bd.customDimensions) bd.customDimensions = scrubObject(bd.customDimensions);
              if (bd.message) bd.message = String(bd.message).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[REDACTED_EMAIL]');
            }
          } catch (_) {}
          return true;
        });
      }
    } catch (_) {}
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
      success,
      properties: scrubObject({
        method: req.method,
        path: req.path || req.url,
        status: res.statusCode
      })
    });
  } catch (_) { /* ignore */ }
}

module.exports = { init, getClient, trackRequest };
