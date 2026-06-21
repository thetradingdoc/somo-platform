#!/usr/bin/env node
/**
 * Import CMS Place of Service + HCPCS/CPT modifier reference tables.
 *
 * Sources (official CMS / industry standard):
 *   Knowledge/billing/cms_place_of_service_codes.json  — CMS POS code set (HIPAA 837P)
 *   Knowledge/billing/cms_hcpcs_modifiers.json         — common claim modifiers
 *
 * Usage: DB_PATH=./var/db/middleware-dev.db node scripts/import-billing-reference-codes.js
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';

const db = require('../database');

const POS_JSON = path.resolve(__dirname, '../../Knowledge/billing/cms_place_of_service_codes.json');
const MOD_JSON = path.resolve(__dirname, '../../Knowledge/billing/cms_hcpcs_modifiers.json');

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const posRows = loadJson(POS_JSON);
  const modRows = loadJson(MOD_JSON);

  const posResult = db.bulkUpsertPlaceOfServiceCodes(posRows);
  const modResult = db.bulkUpsertModifierCodes(modRows);

  const posCount = db.db.prepare('SELECT COUNT(*) AS n FROM place_of_service_codes').get()?.n;
  const modCount = db.db.prepare('SELECT COUNT(*) AS n FROM modifier_codes').get()?.n;

  console.log(JSON.stringify({
    place_of_service: { upserted: posResult.inserted, total: posCount },
    modifiers: { upserted: modResult.inserted, total: modCount }
  }, null, 2));
}

main();
