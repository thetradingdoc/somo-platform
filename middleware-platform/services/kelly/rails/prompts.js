'use strict';

const { isKellyRailsEsEnabled } = require('./config');
const en = require('./prompts/en');
const es = require('./prompts/es');

function resolveLocale(state = {}, opts = {}) {
  const loc = String(state.locale || opts.locale || 'en').slice(0, 2);
  if (loc === 'es' && isKellyRailsEsEnabled()) return 'es';
  return 'en';
}

function laneSystemPrompt(lane, step, state, providerCtx = {}, localeOpt) {
  const locale = localeOpt || resolveLocale(state);
  const mod = locale === 'es' ? es : en;
  return mod.laneSystemPrompt(lane, step, state, providerCtx);
}

module.exports = { laneSystemPrompt, resolveLocale };
