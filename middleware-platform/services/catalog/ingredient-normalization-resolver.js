'use strict';

const { normalizeIngredientName } = require('./ingredient-ontology-resolver');

function normalizeInciToken(raw) {
  const t = String(raw || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\w\s%-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeIngredientName(t) || t;
}

module.exports = { normalizeInciToken, normalizeIngredientName };
