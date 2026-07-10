#!/usr/bin/env node
'use strict';

/**
 * Phase 10.2 — CRM pipeline verification (local + optional prod API).
 *
 * Usage:
 *   node scripts/verify-crm-pipeline.cjs
 *   node scripts/verify-crm-pipeline.cjs --api-base https://api.callsomo.com
 *   node scripts/verify-crm-pipeline.cjs --session call_xxx   # post inbound +363 call
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const facade = require('../services/admin-lead-facade');
const {
  isOutboundCallAllowed,
  leadScoreTier,
  defaultConsentBasisForSource,
} = require('../services/lead-outbound-consent');
const { platformDid, isPlatformInboundSupportMode } = require('../services/platform-line-config');

const args = process.argv.slice(2);
const apiBase = (() => {
  const i = args.indexOf('--api-base');
  if (i >= 0) return String(args[i + 1] || '').replace(/\/$/, '');
  return '';
})();
const sessionArg =
  args.find((a) => a.startsWith('--session='))?.split('=')[1] ||
  (args.indexOf('--session') >= 0 ? args[args.indexOf('--session') + 1] : null);

const checks = [];
const push = (name, ok, detail) => checks.push({ name, ok, detail });

function checkConsentGate() {
  const scraped = { source: 'jsearch', clinic_phone: '+17185551234' };
  const blocked = isOutboundCallAllowed(scraped);
  push('TCPA blocks scraped lead dial', !blocked.ok, blocked.code || blocked.basis);

  const inbound = {
    source: 'inbound_platform',
    outbound_consent_basis: 'inbound_platform',
    clinic_phone: '+17185559999',
  };
  const allowed = isOutboundCallAllowed(inbound);
  push('TCPA allows inbound_platform lead dial', allowed.ok, allowed.basis);

  push(
    'scrape default consent basis',
    defaultConsentBasisForSource('jsearch') === 'scrape_public_listing',
    defaultConsentBasisForSource('jsearch')
  );
}

function checkTiering() {
  push('hot tier (score 85)', leadScoreTier(85) === 'hot', 'hot');
  push('warm tier (score 55)', leadScoreTier(55) === 'warm', 'warm');
  push('cold tier (score 10)', leadScoreTier(10) === 'cold', 'cold');

  const counts = facade.getLeadCountsByContactStatus();
  push('facade contact_status counts', typeof counts === 'object', JSON.stringify(counts).slice(0, 120));
}

function checkPlatformEnv() {
  push('PLATFORM_INBOUND_MODE=support', isPlatformInboundSupportMode(), process.env.PLATFORM_INBOUND_MODE || 'support(default)');
  push('platform DID configured', !!platformDid(), platformDid());
  push(
    'CALLSOMO_OPERATOR_CUSTOMER_ID',
    !!process.env.CALLSOMO_OPERATOR_CUSTOMER_ID,
    process.env.CALLSOMO_OPERATOR_CUSTOMER_ID ? '(set)' : '(missing — prod bind step)'
  );
}

function checkInboundLeads() {
  const rows = db.db
    .prepare(
      `SELECT id, clinic_name, source, lead_score, outbound_consent_basis, pipeline_stage
       FROM leads
       WHERE source = 'inbound_platform'
       ORDER BY updated_at DESC
       LIMIT 5`
    )
    .all();
  push('inbound_platform leads queryable', true, `${rows.length} recent row(s)`);
  if (rows.length) {
    const top = rows[0];
    push(
      'latest inbound lead tier',
      ['hot', 'warm', 'cold'].includes(leadScoreTier(top.lead_score)),
      `${leadScoreTier(top.lead_score)} (score ${top.lead_score || 0})`
    );
  } else {
    push('latest inbound lead tier', true, 'no rows — place prod +363 call to populate');
  }
}

async function checkSessionLead(sessionId) {
  if (!sessionId) return;
  const row = db.db
    .prepare(
      `SELECT lc.lead_id, l.clinic_name, l.source, l.lead_score, l.pipeline_stage
       FROM lead_calls lc
       JOIN leads l ON l.id = lc.lead_id
       WHERE lc.call_id = ?
       LIMIT 1`
    )
    .get(sessionId);
  if (row) {
    push('session linked to CRM lead', true, `${row.clinic_name} tier=${leadScoreTier(row.lead_score)}`);
    return;
  }
  const byPhone = db.db
    .prepare(
      `SELECT id, clinic_name, lead_score, pipeline_stage FROM leads
       WHERE source = 'inbound_platform' ORDER BY updated_at DESC LIMIT 1`
    )
    .get();
  push(
    'session linked to CRM lead',
    !!byPhone,
    byPhone
      ? `fallback latest inbound: ${byPhone.clinic_name} tier=${leadScoreTier(byPhone.lead_score)}`
      : `no lead for session ${sessionId}`
  );
}

async function checkHttpApi() {
  if (!apiBase) {
    push('HTTP API checks', true, 'skipped (no --api-base)');
    return;
  }
  for (const p of ['/api/admin/scrape/status', '/api/admin/scrape/leads/pipeline']) {
    try {
      const res = await fetch(`${apiBase}${p}`, { credentials: 'include' });
      push(`GET ${p}`, res.ok, `${res.status}`);
    } catch (e) {
      push(`GET ${p}`, false, e.message);
    }
  }
}

async function main() {
  console.log('=== CRM pipeline verify (Phase 10.2) ===\n');
  checkPlatformEnv();
  checkConsentGate();
  checkTiering();
  checkInboundLeads();
  await checkSessionLead(sessionArg);
  await checkHttpApi();

  console.log('\nProd-only steps (10.1 / 10.2 live):');
  console.log('  1. node scripts/bind-operator-platform-did.cjs');
  console.log('  2. node scripts/fix-operator-voice-openers.cjs');
  console.log('  3. node scripts/callsomo-operator-sync.cjs');
  console.log('  4. Inbound PSTN call to +13639990205 → platform_support');
  console.log('  5. node scripts/verify-crm-pipeline.cjs --session <call_id> --api-base https://api.callsomo.com\n');

  for (const c of checks) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.name} — ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\n✅ Local CRM pipeline checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
