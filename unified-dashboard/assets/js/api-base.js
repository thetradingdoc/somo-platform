/**
 * Shared API base for provider portal pages on split-domain staging.
 * config.js sets window.API_BASE on myskinandcare.com → api.myskinandcare.com
 */
(function (global) {
  function resolveApiBase() {
    if (global.API_BASE) return String(global.API_BASE).replace(/\/$/, '');
    const host = (global.location?.hostname || '').toLowerCase();
    if (
      host === 'myskinandcare.com' ||
      host === 'www.myskinandcare.com' ||
      host.endsWith('.myskinandcare.com') ||
      host === 'skinandcare.com' ||
      host === 'www.skinandcare.com'
    ) {
      return 'https://api.myskinandcare.com';
    }
    return (global.location?.origin || 'http://localhost:4000').replace(/\/$/, '');
  }
  global.resolveApiBase = resolveApiBase;
})(typeof window !== 'undefined' ? window : global);
