'use strict';

/**
 * Pure ZIP / county string normalization — no database, no env, safe for
 * unit tests and optional reuse from other packages without pulling `database.js`.
 */

function normalizeZip(rawZip) {
  return String(rawZip || '').replace(/[^\d]/g, '').slice(0, 5);
}

function normalizeCountyName(rawCounty) {
  return String(rawCounty || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\bcounty\b/g, '')
    .replace(/\bparish\b/g, '')
    .replace(/\bborough\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  normalizeZip,
  normalizeCountyName
};
