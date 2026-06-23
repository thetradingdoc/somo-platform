'use strict';

/** Prefer sticky preferred_language over ephemeral state.locale for deterministic replies. */
function resolveStickyLocale(state = {}) {
  return state.flags?.preferred_language || state.preferred_language || state.locale || 'en';
}

function withStickyLocale(state = {}) {
  const locale = resolveStickyLocale(state);
  return locale === state.locale ? state : { ...state, locale };
}

module.exports = { resolveStickyLocale, withStickyLocale };
