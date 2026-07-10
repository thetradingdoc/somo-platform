'use strict';

/** Prefer projection.flags_json.locale (SSOT) for deterministic replies. */
function resolveStickyLocale(state = {}) {
  return state.flags?.locale || state.locale || 'en';
}

function withStickyLocale(state = {}) {
  const locale = resolveStickyLocale(state);
  return locale === state.locale ? state : { ...state, locale };
}

module.exports = { resolveStickyLocale, withStickyLocale };
