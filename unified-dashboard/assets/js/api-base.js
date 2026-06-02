/**
 * Shared API base for provider portal pages on split-domain staging.
 * config.js sets window.API_BASE on callsomo.com → api.callsomo.com
 */
(function (global) {
  function resolveApiBase() {
    if (global.API_BASE) return String(global.API_BASE).replace(/\/$/, '');
    const host = (global.location?.hostname || '').toLowerCase();
    if (
      host === 'callsomo.com' ||
      host === 'www.callsomo.com' ||
      host.endsWith('.callsomo.com')
    ) {
      return 'https://api.callsomo.com';
    }
    return (global.location?.origin || 'http://localhost:4000').replace(/\/$/, '');
  }
  global.resolveApiBase = resolveApiBase;
})(typeof window !== 'undefined' ? window : global);
