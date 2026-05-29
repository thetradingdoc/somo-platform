'use strict';

const axios = require('axios');

function isLocalhostBase(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    const host = (u.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return true;
  }
}

function normalizeBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Base URL Twilio/Retell can reach for voice webhooks (must be public HTTPS in practice).
 * Priority: TWILIO_OUTBOUND_WEBHOOK_URL > PUBLIC_API_BASE_URL > NGROK_URL > API_BASE_URL (if not localhost)
 * Local dev: probes ngrok agent at 127.0.0.1:4040 when API_BASE_URL is localhost.
 */
async function resolveTelephonyWebhookBase() {
  const explicit = [
    process.env.TWILIO_OUTBOUND_WEBHOOK_URL,
    process.env.PUBLIC_API_BASE_URL,
    process.env.NGROK_URL
  ].find((v) => v && String(v).trim());

  if (explicit) {
    const base = normalizeBase(explicit);
    if (!isLocalhostBase(base)) return base;
  }

  const apiBase = normalizeBase(process.env.API_BASE_URL || process.env.BASE_URL);
  if (apiBase && !isLocalhostBase(apiBase)) {
    return apiBase;
  }

  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }

  try {
    const ngrokInfo = await axios.get('http://127.0.0.1:4040/api/tunnels', { timeout: 800 });
    const tunnels = ngrokInfo?.data?.tunnels || [];
    const httpsTunnel = tunnels.find((t) => t.proto === 'https');
    if (httpsTunnel?.public_url) {
      const base = normalizeBase(httpsTunnel.public_url);
      console.log(`🔗 DodgeCall/Twilio webhooks using ngrok: ${base}`);
      return base;
    }
  } catch {
    // ngrok not running
  }

  throw new Error(
    'Demo calls need a public webhook URL. Set TWILIO_OUTBOUND_WEBHOOK_URL or NGROK_URL to your ngrok HTTPS URL ' +
      '(e.g. https://xxxx.ngrok-free.app), or run: ngrok http 4000 — then restart middleware. ' +
      'Twilio cannot use http://localhost:4000.'
  );
}

module.exports = {
  isLocalhostBase,
  normalizeBase,
  resolveTelephonyWebhookBase
};
