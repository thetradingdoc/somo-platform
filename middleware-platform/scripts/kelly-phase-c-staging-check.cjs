#!/usr/bin/env node
'use strict';

/**
 * Phase C staging preflight — env + module checks (no live Retell).
 *
 * Usage: node scripts/kelly-phase-c-staging-check.cjs
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const failures = [];

function requireEnv(name, optional = false) {
  const v = process.env[name];
  if (!v && !optional) failures.push(`missing env ${name}`);
  return v;
}

function checkFile(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) failures.push(`missing file ${rel}`);
}

checkFile('services/kelly/rails/language.js');
checkFile('config/clinical-opqrst/es.json');

requireEnv('KELLY_RAILS_V2');
requireEnv('KELLY_RAILS_ES_ENABLED', true);
requireEnv('KELLY_OPQRST_ES_PACK', true);

if (process.env.KELLY_RAILS_V2 !== '1') {
  failures.push('KELLY_RAILS_V2 must be 1 for Phase C staging');
}

if (process.env.KELLY_ALLOW_HYBRID_GRAPH === '1') {
  failures.push('KELLY_ALLOW_HYBRID_GRAPH must be 0 on staging');
}

const { evaluateFirstTurnLanguage } = require('../services/kelly/rails/language');
const es = evaluateFirstTurnLanguage('Tengo un sarpullido en la pierna');
if (es.language !== 'es') {
  failures.push(`language detector expected es, got ${es.language}`);
}

const { isOpqrstEsPackActive } = require('../services/kelly/rails/config');
if (process.env.KELLY_OPQRST_ES_PACK === 'v1' && !isOpqrstEsPackActive()) {
  failures.push('KELLY_OPQRST_ES_PACK=v1 but isOpqrstEsPackActive() is false');
}

if (failures.length) {
  console.error('Phase C staging check FAILED:');
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}

console.log('Phase C staging preflight OK (env + language + OPQRST pack wiring).');
console.log('Next: run verify:kelly-rails-runtime with DB_PATH after a staging Spanish turn.');
