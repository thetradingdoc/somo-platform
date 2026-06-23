#!/usr/bin/env node
/**
 * After Office Ally + Inovalon batches exist, clear CMS-only readiness waivers so Step 0–2 gates enforce vendors.
 * If batches are missing, suggests keeping PAYOR_READINESS_VENDOR_MODE=cms_only.
 *
 *   npm run verify:payor:vendor-env
 */

'use strict';

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../../database');

function truthy(name) {
  return ['1', 'true', 'yes'].includes(String(process.env[name] || '').toLowerCase().trim());
}

const vendorMode = String(process.env.PAYOR_READINESS_VENDOR_MODE || '').trim().toLowerCase();
const cmsOnly =
  vendorMode === 'cms_only' ||
  vendorMode === 'cms-only' ||
  truthy('PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY');

const officeCount = Number(
  db.db.prepare(`SELECT COUNT(*) AS c FROM payor_ingest_batches WHERE source = 'office_ally'`).get()?.c || 0
);
const inovalonCount = Number(
  db.db.prepare(`SELECT COUNT(*) AS c FROM payor_ingest_batches WHERE source = 'inovalon'`).get()?.c || 0
);

const out = {
  event: 'payor_vendor_readiness_env_check',
  cms_only_mode: cmsOnly,
  office_ally_batches: officeCount,
  inovalon_batches: inovalonCount,
  hints: []
};

if (officeCount > 0 && inovalonCount > 0 && cmsOnly) {
  out.hints.push(
    'Vendor batches exist — remove PAYOR_READINESS_VENDOR_MODE=cms_only and PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY so Step 0–2 readiness enforces Office Ally + Inovalon.'
  );
}
if (officeCount === 0 && inovalonCount === 0 && !cmsOnly) {
  out.hints.push(
    'No Office Ally/Inovalon batches yet — set PAYOR_READINESS_VENDOR_MODE=cms_only (or PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1) until exports are ingested.'
  );
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);
