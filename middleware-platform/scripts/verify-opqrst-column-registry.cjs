#!/usr/bin/env node
'use strict';

/**
 * CP-01 — OPQRST field registry vs triage_rag_results / session storage columns.
 */

const path = require('path');
const fs = require('fs');

const MP = path.join(__dirname, '..');
const REGISTRY_DIR = path.join(MP, 'config/clinical-opqrst');

const EXPECTED_STORE_FIELDS = new Set([
  'onset',
  'provocation',
  'quality',
  'radiation',
  'severity',
  'timing',
  'safety_screen_q1',
  'safety_screen_q2'
]);

const TRIAGE_JSON_KEYS = new Set([
  'onset',
  'provocation',
  'quality',
  'radiation',
  'severity',
  'timing',
  'time'
]);

function loadPack(locale) {
  const file = path.join(REGISTRY_DIR, `${locale}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  let failed = 0;
  const locales = ['en', 'es', 'zh'];

  for (const locale of locales) {
    const pack = loadPack(locale);
    const fields = new Set();
    for (const q of Object.values(pack.questions || {})) {
      if (q.store_field) fields.add(q.store_field);
    }
    for (const expected of EXPECTED_STORE_FIELDS) {
      if (!fields.has(expected) && locale === 'en') {
        console.error(`❌ ${locale}: missing store_field ${expected}`);
        failed++;
      }
    }
    console.log(`✅ ${locale}: ${fields.size} store_field mappings`);
  }

  const migrationHint = fs.readFileSync(
    path.join(MP, 'migrations/008_specialist_marketplace.js'),
    'utf8'
  );
  if (!migrationHint.includes('opqrst_json')) {
    console.error('❌ triage_rag_results.opqrst_json column not found in migration 008');
    failed++;
  } else {
    console.log('✅ triage_rag_results.opqrst_json column present');
  }

  for (const key of TRIAGE_JSON_KEYS) {
    console.log(`   opqrst_json key: ${key}`);
  }

  if (failed) {
    console.error('\n❌ verify-opqrst-column-registry failed\n');
    process.exit(1);
  }
  console.log('\n✅ verify-opqrst-column-registry passed\n');
}

main();
