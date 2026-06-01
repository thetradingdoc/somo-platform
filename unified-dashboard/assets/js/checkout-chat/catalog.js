/**
 * Product catalog load + 429 retry (mirrors patient-app checkoutCatalogHelpers intent).
 */
(function (global) {
  'use strict';

  const STRIP_IMAGE_FALLBACK_BY_ID = {
    'prod-vitamin-b3-serum-pore-sebum-control': '/images/products/vitamin-b3-serum.png',
    'prod-retinol-peptide-night-serum': '/images/products/retinol-brightening-night-serum.png',
    'prod-skin-hydration-serum-snail-mucin': '/images/products/dark-spot-repair-snail-mucin-serum.png',
    'prod-vitamin-c-serum-antioxidant-pro-shield': '/images/products/vitamin-c-serum.png'
  };

  function fetchWith429Retry(url, init, options) {
    init = init || {};
    options = options || {};
    const maxAttempts = options.maxAttempts != null ? options.maxAttempts : 5;
    const baseMs = options.baseMs != null ? options.baseMs : 350;
    function sleep(ms) {
      return new Promise(function (r) {
        setTimeout(r, ms);
      });
    }
    function attempt(i) {
      return fetch(url, init).then(function (res) {
        if (res.status !== 429 || i >= maxAttempts - 1) return res;
        const ra = res.headers.get('Retry-After');
        let delayMs = ra ? parseInt(ra, 10) * 1000 : baseMs * Math.pow(2, i);
        if (!Number.isFinite(delayMs) || delayMs < 0) delayMs = baseMs * Math.pow(2, i);
        delayMs += Math.random() * 300;
        return sleep(delayMs).then(function () {
          return attempt(i + 1);
        });
      });
    }
    return attempt(0);
  }

  global.SomoCheckoutChat = global.SomoCheckoutChat || {};
  global.SomoCheckoutChat.STRIP_IMAGE_FALLBACK_BY_ID = STRIP_IMAGE_FALLBACK_BY_ID;
  global.SomoCheckoutChat.fetchWith429Retry = fetchWith429Retry;
})(typeof window !== 'undefined' ? window : global);
