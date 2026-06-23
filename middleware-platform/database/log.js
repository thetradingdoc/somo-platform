'use strict';

function isDbQuiet() {
  if (process.env.DB_VERBOSE === '1') return false;
  if (process.env.DB_QUIET === '1') return true;
  if (process.env.NODE_ENV === 'test') return true;
  const ci = String(process.env.CI || '').toLowerCase();
  if (ci === '1' || ci === 'true') return true;
  return false;
}

function dbLog(...args) {
  if (!isDbQuiet()) console.log(...args);
}

function dbWarn(...args) {
  if (!isDbQuiet()) console.warn(...args);
}

module.exports = { isDbQuiet, dbLog, dbWarn };
