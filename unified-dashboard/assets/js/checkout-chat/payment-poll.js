/**
 * Voice checkout status poll loop.
 */
(function (global) {
  'use strict';

  async function pollVoiceCheckoutUntilComplete(apiBase, checkoutId, opts) {
    const maxMs = (opts && opts.maxMs) || 60000;
    const started = Date.now();
    const base = String(apiBase || '').replace(/\/$/, '');
    while (Date.now() - started < maxMs) {
      const res = await fetch(
        base + '/voice/checkout/status/' + encodeURIComponent(String(checkoutId)),
        { headers: { 'ngrok-skip-browser-warning': 'true' } }
      );
      const payload = await res.json();
      if (res.ok && payload && payload.success && payload.status === 'completed') {
        return payload;
      }
      await new Promise(function (r) {
        setTimeout(r, 750);
      });
    }
    return null;
  }

  global.SomoCheckoutChat = global.SomoCheckoutChat || {};
  global.SomoCheckoutChat.pollVoiceCheckoutUntilComplete = pollVoiceCheckoutUntilComplete;
})(typeof window !== 'undefined' ? window : global);
