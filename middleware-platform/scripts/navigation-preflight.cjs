#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const {
  METRO_ENTITY_ID,
  METRO_PAYER_ID,
  METRO_ALIASES,
  EXPECTED_SPECIALTIES,
  resolveNavCustomerId,
  resolveNavDid,
  resolveNavClinicId,
} = require('./lib/navigation-demo-config.cjs');

const EVIDENCE_DIR = path.join(__dirname, '..', 'var', 'evidence', 'navigation');
const GATE_PATH = path.join(EVIDENCE_DIR, 'P0_GATE.json');

function fail(msg) {
  const err = new Error(msg);
  err.code = 'NAVIGATION_PREFLIGHT_FAIL';
  throw err;
}

function parseSpecialtyArray(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map((s) => String(s).replace(/\s+/g, ''));
    }
    if (typeof parsed === 'string') return [parsed.replace(/\s+/g, '')];
  } catch (_) {}
  return [];
}

function assertMetroPayor() {
  const entity = db.db
    .prepare('SELECT id FROM payor_canonical_entities WHERE id = ? AND status = ?')
    .get(METRO_ENTITY_ID, 'active');
  if (!entity) fail(`Missing payor_canonical_entities id=${METRO_ENTITY_ID}`);

  const alias = db.db
    .prepare(
      `
    SELECT id FROM payor_entity_aliases
    WHERE entity_id = ? AND alias_normalized = ?
  `
    )
    .get(METRO_ENTITY_ID, 'metro health plus');
  if (!alias) fail('Missing payor_entity_aliases alias_normalized=metro health plus');
  return { entity_id: METRO_ENTITY_ID, alias_ok: true };
}

function assertInsurancePayers() {
  const row = db.db
    .prepare('SELECT payer_id, is_active FROM insurance_payers WHERE payer_id = ?')
    .get(METRO_PAYER_ID);
  if (!row) fail(`Missing insurance_payers payer_id=${METRO_PAYER_ID}`);
  if (!row.is_active) fail(`insurance_payers ${METRO_PAYER_ID} is not active`);
  return { payer_id: METRO_PAYER_ID, active: true };
}

function assertNavigationCustomer() {
  const customerId = resolveNavCustomerId();
  const expectedDid = resolveNavDid();
  const customer = db.getCustomer(customerId);
  if (!customer) fail(`Missing navigation customer id=${customerId}`);
  if (String(customer.customer_type || '') !== 'navigation') {
    fail(`Customer ${customerId} customer_type=${customer.customer_type} (expected navigation)`);
  }
  const did = String(customer.twilio_phone_number || '').replace(/\s/g, '');
  const normExpected = String(expectedDid || '').replace(/\s/g, '');
  if (!did || did !== normExpected) {
    fail(`Customer twilio_phone_number=${customer.twilio_phone_number} (expected ${expectedDid})`);
  }
  const clinicId = resolveNavClinicId(db);
  if (!clinicId) fail(`Could not resolve navigation clinic_id for customer ${customerId}`);
  return { customer_id: customerId, clinic_id: clinicId, twilio_phone_number: did };
}

function assertOnlineProviders(clinicId) {
  const rows = db.db
    .prepare(
      `
    SELECT pp.email, pp.specialty, ps.is_online
    FROM provider_profiles pp
    LEFT JOIN provider_status ps ON lower(ps.email) = lower(pp.email)
    WHERE pp.clinic_id = ? AND pp.is_active = 1
  `
    )
    .all(clinicId);

  const bySpecialty = new Map();
  for (const row of rows) {
    const specs = parseSpecialtyArray(row.specialty);
    const primary = specs[0] || '';
    if (!primary) continue;
    if (!bySpecialty.has(primary)) bySpecialty.set(primary, []);
    bySpecialty.get(primary).push({
      email: row.email,
      is_online: !!row.is_online,
    });
  }

  const missing = [];
  const offline = [];
  for (const spec of EXPECTED_SPECIALTIES) {
    const norm = spec.replace(/\s+/g, '');
    const matches = bySpecialty.get(norm) || [];
    if (!matches.length) missing.push(spec);
    else if (!matches.some((m) => m.is_online)) offline.push(spec);
  }

  if (missing.length) fail(`Missing provider_profiles specialties: ${missing.join(', ')}`);
  if (offline.length) fail(`Providers not online for specialties: ${offline.join(', ')}`);

  return {
    clinic_id: clinicId,
    provider_count: rows.length,
    specialties_online: EXPECTED_SPECIALTIES,
  };
}

function assertSeedIdempotent() {
  const aliasCount = db.db
    .prepare('SELECT COUNT(*) AS c FROM payor_entity_aliases WHERE entity_id = ?')
    .get(METRO_ENTITY_ID).c;
  if (aliasCount !== METRO_ALIASES.length) {
    fail(`Expected ${METRO_ALIASES.length} Metro aliases, found ${aliasCount}`);
  }

  const { main: runSeed } = require('./seed-navigation-demo.cjs');
  return runSeed()
    .then(() => {
      const after = db.db
        .prepare('SELECT COUNT(*) AS c FROM payor_entity_aliases WHERE entity_id = ?')
        .get(METRO_ENTITY_ID).c;
      if (after !== METRO_ALIASES.length) {
        fail(`Idempotency: alias count changed after re-seed (${aliasCount} → ${after})`);
      }
      return { alias_count: after, idempotent: true };
    });
}

function writeGate(payload) {
  const navDid = resolveNavDid();
  const gateDoc = {
    gate: 'P0',
    passed: true,
    timestamp: new Date().toISOString(),
    assertions: {
      payor_entity: !!payload.assertions?.metro_payor?.entity_id,
      payor_alias: !!payload.assertions?.metro_payor?.alias_ok,
      insurance_payers: !!payload.assertions?.insurance_payers?.active,
      providers_online: payload.assertions?.online_providers?.provider_count ?? 0,
      navigation_did: payload.assertions?.navigation_customer?.twilio_phone_number || navDid,
    },
    open_gaps_p1: [
      { gap: 'voice-account-resolution.js DID → navigation customer', phase: 'P1-S1' },
      { gap: 'voice-incoming-handler.js call_type=consumer_navigation', phase: 'P1-S1' },
      { gap: 'Tools not in retell-functions.json', phase: 'P1-S2+' },
      { gap: 'GCS prod DB upload after seed', phase: 'P1-S5 deploy' },
    ],
    details: payload.assertions,
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(GATE_PATH, JSON.stringify(gateDoc, null, 2) + '\n');
  console.log(`\n✅ Wrote ${GATE_PATH}`);
}

async function main() {
  const skipIdempotent = process.argv.includes('--skip-idempotent');
  console.log('🔍 navigation-preflight.cjs');

  const results = {
    at: new Date().toISOString(),
    gate: 'P0-S3',
    assertions: {},
  };

  results.assertions.metro_payor = assertMetroPayor();
  console.log('✅ Assertion 1: Metro canonical + metro health plus alias');

  results.assertions.insurance_payers = assertInsurancePayers();
  console.log('✅ Assertion 2: insurance_payers METRO-HEALTH-PLUS active');

  results.assertions.navigation_customer = assertNavigationCustomer();
  console.log(
    `✅ Assertion 3: navigation customer + DID + clinic_id=${results.assertions.navigation_customer.clinic_id}`
  );

  results.assertions.online_providers = assertOnlineProviders(
    results.assertions.navigation_customer.clinic_id
  );
  console.log(`✅ Assertion 4: ${EXPECTED_SPECIALTIES.length} specialties online on navigation clinic`);

  if (!skipIdempotent) {
    results.assertions.idempotent = await assertSeedIdempotent();
    console.log('✅ Assertion 5: re-seed idempotent (alias count stable)');
  } else {
    console.log('↩  Assertion 5 skipped (--skip-idempotent)');
  }

  results.pass = true;
  writeGate(results);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ navigation-preflight failed:', err.message);
    process.exit(1);
  });
}

module.exports = {
  main,
  assertMetroPayor,
  assertInsurancePayers,
  assertNavigationCustomer,
  assertOnlineProviders,
};
