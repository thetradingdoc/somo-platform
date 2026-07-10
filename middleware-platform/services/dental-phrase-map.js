'use strict';

/**
 * Loader for Knowledge/rules/dental-phrase-map.json (Track H dental spine SSOT).
 */

const fs = require('fs');
const path = require('path');

const MAP_PATH = path.resolve(__dirname, '../../Knowledge/rules/dental-phrase-map.json');

let _cache = null;

function compileEntry(entry) {
  const patterns = Array.isArray(entry.patterns) ? entry.patterns : [];
  return {
    id: entry.id || null,
    code: entry.code,
    childCode: entry.childCode || null,
    compiled: patterns.map((p) => new RegExp(p, 'i'))
  };
}

function loadDentalPhraseMap() {
  if (_cache) return _cache;
  const raw = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  _cache = {
    version: raw.version || '1',
    entries: (raw.entries || []).map(compileEntry)
  };
  return _cache;
}

function getDentalPhraseEntries() {
  return loadDentalPhraseMap().entries;
}

function clearDentalPhraseMapCache() {
  _cache = null;
}

module.exports = {
  MAP_PATH,
  loadDentalPhraseMap,
  getDentalPhraseEntries,
  clearDentalPhraseMapCache
};
