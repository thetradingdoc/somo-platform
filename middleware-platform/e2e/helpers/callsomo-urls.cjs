'use strict';

/** Live E2E hosts for callsomo.com (override via PW_* or UI_BASE_URL / MIDDLEWARE_API_BASE). */
const UI_BASE = (
  process.env.PW_UI_BASE_URL ||
  process.env.UI_BASE_URL ||
  'https://callsomo.com'
).replace(/\/$/, '');

const API_BASE = (
  process.env.PW_API_BASE_URL ||
  process.env.MIDDLEWARE_API_BASE ||
  'https://api.callsomo.com'
).replace(/\/$/, '');

module.exports = { UI_BASE, API_BASE };
