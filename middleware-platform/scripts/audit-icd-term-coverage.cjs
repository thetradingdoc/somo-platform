#!/usr/bin/env node
'use strict';

/**
 * E-02 — audit ICD term corrections coverage vs lay-language expansions.
 */

const fs = require('fs');
const path = require('path');

const expansions = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../Knowledge/rules/lay-language-icd-expansions.json'), 'utf8')
);
const corrections = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../Knowledge/RAG/icd10_term_corrections.json'), 'utf8')
);

const expansionTerms = Object.keys(expansions.terms || expansions || {});
const correctionTerms = Object.keys(corrections.corrections || corrections || {});
const missing = expansionTerms.filter((t) => !correctionTerms.includes(t));

console.log(JSON.stringify({
  expansion_terms: expansionTerms.length,
  correction_terms: correctionTerms.length,
  missing_in_corrections: missing.length,
  sample_missing: missing.slice(0, 10),
  ok: missing.length <= Math.ceil(expansionTerms.length * 0.15)
}, null, 2));

process.exit(missing.length <= Math.ceil(expansionTerms.length * 0.15) ? 0 : 2);
