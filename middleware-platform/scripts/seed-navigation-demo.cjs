#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const ProviderService = require('../services/provider-service');
const { provisionSaasTenant } = require('../services/saas-tenant-provision');
const {
  METRO_ENTITY_ID,
  METRO_PAYER_ID,
  METRO_ALIASES,
  PROVIDERS,
  resolveNavCustomerId,
  resolveNavDid,
} = require('./lib/navigation-demo-config.cjs');
const { seedDemoEmployerPlan } = require('../services/navigation/navigation-employer-service');

const NAV_CUSTOMER_ID = resolveNavCustomerId();
const NAV_DID = resolveNavDid();
const NAV_ADMIN_EMAIL = 'nav-admin@doclittle.example';

function addAvailabilityBlocks(providerEmail, daysAhead = 60) {
  const blocks = [];
  const now = new Date();
  for (let d = 0; d < daysAhead; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    const day = date.getDay();
    if (day === 0 || day === 6) continue;
    const dateStr = date.toISOString().slice(0, 10);
    blocks.push({
      id: `avb_${crypto.randomBytes(8).toString('hex')}`,
      provider_email: providerEmail,
      block_type: 'available',
      start_datetime: `${dateStr}T09:00:00`,
      end_datetime: `${dateStr}T18:00:00`,
      title: 'Business hours',
    });
  }
  return blocks;
}

function seedNavigationTenant() {
  console.log('\n── Step 1: Navigation tenant ──');

  let customer = db.getCustomer(NAV_CUSTOMER_ID);
  if (!customer) {
    db.createCustomer({
      id: NAV_CUSTOMER_ID,
      email: NAV_ADMIN_EMAIL,
      name: 'Somo Health Navigator',
      company_name: 'Somo Health Navigator',
      use_case: 'healthcare_clinic',
      status: 'active',
      email_verified: 1,
    });
    console.log('✅ Created navigation customer:', NAV_CUSTOMER_ID);
    customer = db.getCustomer(NAV_CUSTOMER_ID);
  } else {
    console.log('↩  Navigation customer already exists:', NAV_CUSTOMER_ID);
  }

  db.updateCustomer(NAV_CUSTOMER_ID, {
    customer_type: 'navigation',
    twilio_phone_number: NAV_DID,
    status: 'active',
    billing_enforcement_paused: 1,
    billing_enforcement_paused_reason: 'navigation_demo_pitch',
    kelly_status: 'active',
    retell_agent_status: 'active',
    retell_agent_id: require('../services/navigation/navigation-config').resolveNavigationRetellAgentId(),
  });

  const navMinutes = Number(process.env.NAVIGATION_DEMO_MINUTES || 10000);
  const credits = db.getCustomerCredits(NAV_CUSTOMER_ID);
  if (!credits) {
    db.allocateFreeCredits(NAV_CUSTOMER_ID, navMinutes);
    console.log(`✅ Allocated ${navMinutes} navigation demo minutes`);
  }

  if (customer?.merchant_id) {
    const merchantRow = db.db
      .prepare('SELECT id FROM merchants WHERE id = ?')
      .get(customer.merchant_id);
    if (!merchantRow) {
      console.warn(`⚠  Orphan merchant_id ${customer.merchant_id} — clearing for re-provision`);
      db.updateCustomer(NAV_CUSTOMER_ID, { merchant_id: null });
      customer = db.getCustomer(NAV_CUSTOMER_ID);
    }
  }

  if (customer?.merchant_id) {
    const clinicRow = db.db
      .prepare('SELECT clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1')
      .get(customer.merchant_id);
    if (clinicRow?.clinic_id) {
      console.log('↩  Merchant already provisioned:', customer.merchant_id);
      return { merchantId: customer.merchant_id, clinicId: clinicRow.clinic_id };
    }
    console.warn(`⚠  Merchant ${customer.merchant_id} missing clinic — re-provisioning clinic`);
  }

  const { merchantId, clinicId } = provisionSaasTenant(db, {
    customerId: NAV_CUSTOMER_ID,
    clinicName: 'Somo Health Navigator',
    phone: NAV_DID,
    email: NAV_ADMIN_EMAIL,
    useCase: 'healthcare_clinic',
    customerType: 'navigation',
  });

  const envClinic = process.env.NAVIGATION_CLINIC_ID;
  if (envClinic && clinicId && clinicId !== envClinic) {
    console.warn(
      `⚠  Auto clinic_id (${clinicId}) differs from NAVIGATION_CLINIC_ID (${envClinic}). Set env to match.`
    );
  }

  console.log('✅ Provisioned merchant:', merchantId);
  console.log('✅ Provisioned clinic:  ', clinicId);
  return { merchantId, clinicId };
}

function seedMetroHealthPlus() {
  console.log('\n── Step 2: Metro Health Plus payor ──');

  db.upsertPayorCanonicalEntities([
    {
      id: METRO_ENTITY_ID,
      canonical_name: 'Metro Health Plus',
      canonical_payer_id: METRO_PAYER_ID,
      canonical_npi: null,
      canonical_ein: null,
      state_scope: 'NY',
      status: 'active',
    },
  ]);
  console.log('✅ Canonical entity upserted:', METRO_ENTITY_ID);

  db.upsertPayorEntityAliases(
    METRO_ALIASES.map((row) => ({
      id: row.id,
      entity_id: METRO_ENTITY_ID,
      alias: row.alias,
      alias_normalized: row.normalized,
      source: 'navigation_demo_seed',
      confidence: 1.0,
    }))
  );
  console.log(
    '✅ Aliases upserted:',
    METRO_ALIASES.map((a) => a.normalized).join(', ')
  );

  const existingPayer = db.db
    .prepare('SELECT id FROM insurance_payers WHERE payer_id = ?')
    .get(METRO_PAYER_ID);

  if (!existingPayer) {
    db.db
      .prepare(
        `
      INSERT INTO insurance_payers (id, payer_id, payer_name, aliases, is_active, last_updated)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `
      )
      .run(
        `ins_${uuidv4()}`,
        METRO_PAYER_ID,
        'Metro Health Plus',
        JSON.stringify(['Metro Health Plus HMO', 'Metro Plus', 'MHP'])
      );
    console.log('✅ insurance_payers row created:', METRO_PAYER_ID);
  } else {
    db.db
      .prepare(
        `
      UPDATE insurance_payers
      SET payer_name = ?, aliases = ?, is_active = 1, last_updated = datetime('now')
      WHERE payer_id = ?
    `
      )
      .run(
        'Metro Health Plus',
        JSON.stringify(['Metro Health Plus HMO', 'Metro Plus', 'MHP']),
        METRO_PAYER_ID
      );
    console.log('↩  insurance_payers row updated:', METRO_PAYER_ID);
  }
}

function syncProviderProfileSpecialty(email, specialty, clinicId) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = ProviderService.getProviderProfileByEmail(normalizedEmail);
  if (!existing) return null;

  const specialtyJson = JSON.stringify([String(specialty).replace(/\s+/g, '')]);
  db.db
    .prepare(
      `
    UPDATE provider_profiles
    SET specialty = ?, clinic_id = ?, is_active = 1, updated_at = datetime('now')
    WHERE lower(email) = lower(?)
  `
    )
    .run(specialtyJson, clinicId, normalizedEmail);
  return ProviderService.getProviderProfileByEmail(normalizedEmail);
}

function seedProviders(clinicId) {
  console.log('\n── Step 3: Provider profiles + availability ──');

  for (const p of PROVIDERS) {
    let cust = db.getCustomerByEmail(p.email);
    if (!cust) {
      const custId = `cust-nav-prov-${p.specialty.toLowerCase()}`;
      db.createCustomer({
        id: custId,
        email: p.email,
        name: p.name,
        company_name: 'Somo Health Navigator',
        use_case: 'healthcare_clinic',
        status: 'active',
        provider_profile: JSON.stringify({ specialty: p.specialty }),
      });
      cust = db.getCustomer(custId);
      console.log('✅ Provider customer:', p.email);
    } else {
      db.updateCustomer(cust.id, {
        provider_profile: JSON.stringify({ specialty: p.specialty }),
        status: 'active',
      });
      console.log('↩  Provider customer exists:', p.email);
    }

    let profile = ProviderService.ensureProviderProfileForEmail(p.email, clinicId);
    if (!profile) {
      console.error('❌ Failed to create provider_profile for:', p.email);
      continue;
    }

    profile = syncProviderProfileSpecialty(p.email, p.specialty, clinicId) || profile;
    const attrs = {
      city: 'New York',
      state: 'NY',
      zip: p.zip || '10001',
      hours: p.hours || null,
      match_reason: p.match_reason || null
    };
    db.db
      .prepare(
        `UPDATE provider_profiles SET phone = ?, bio = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(p.phone || null, JSON.stringify(attrs), profile.id);
    console.log('   profile id:', profile.id, '| specialty:', p.specialty);

    ProviderService.setProviderOnline(p.email, true);

    const blocks = addAvailabilityBlocks(p.email);
    let inserted = 0;
    for (const b of blocks) {
      try {
        ProviderService.createAvailabilityBlock(b);
        inserted++;
      } catch (e) {
        if (!e.message?.includes('UNIQUE')) console.warn('   skip block:', e.message);
      }
    }
    console.log('   availability blocks inserted:', inserted);
  }
}

function seedProviderNetworkEdges() {
  console.log('\n── Step 4: Provider payor network edges (P3) ──');
  const { v4: uuidv4 } = require('uuid');
  let linked = 0;
  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i];
    const npi = `1992999${String(100 + i).padStart(3, '0')}`;
    const entityId = `pre_nav_${p.specialty.toLowerCase()}`;
    db.db
      .prepare(
        `INSERT INTO provider_registry_entities (id, canonical_npi, organization_name, first_name, last_name, provider_type, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'individual', 'active', datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET canonical_npi = excluded.canonical_npi, updated_at = datetime('now')`
      )
      .run(entityId, npi, `${p.name} Practice`, p.name.split(' ').slice(-1)[0], p.name.split(' ')[0]);
    const profile = db.db
      .prepare('SELECT id FROM provider_profiles WHERE email = ? ORDER BY created_at DESC LIMIT 1')
      .get(p.email);
    if (profile?.id) {
      try {
        db.db.prepare('UPDATE provider_profiles SET npi = ? WHERE id = ?').run(npi, profile.id);
      } catch (_) {
        /* npi column optional */
      }
    }
    db.db
      .prepare(
        `INSERT INTO provider_payer_networks (
          id, provider_entity_id, payor_entity_id, network_status, confidence, source, created_at, updated_at
        ) VALUES (?, ?, ?, 'in_network', 0.95, 'navigation_demo_seed', datetime('now'), datetime('now'))
        ON CONFLICT DO NOTHING`
      )
      .run(`ppn_${entityId}_${METRO_ENTITY_ID}`, entityId, METRO_ENTITY_ID);
    linked += 1;
  }
  console.log('✅ Network edges seeded:', linked);
}

function seedEmployerPilot() {
  console.log('\n── Step 5: Employer pilot seed (P4) ──');
  const employerId = seedDemoEmployerPlan();
  console.log('✅ Employer plan seeded:', employerId);
}

async function main() {
  const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
  const phases = phaseArg ? phaseArg.split('=')[1].split(',') : [];

  console.log('🌱 seed-navigation-demo.cjs — P0 seed');
  console.log('   NAV_CUSTOMER_ID:', NAV_CUSTOMER_ID);
  console.log('   NAV_DID:        ', NAV_DID);

  const { clinicId } = seedNavigationTenant();
  if (!clinicId) {
    console.error('❌ Could not resolve navigation clinic_id. Aborting.');
    process.exit(1);
  }

  seedMetroHealthPlus();
  seedProviders(clinicId);

  if (phases.includes('p3') || phases.includes('all')) seedProviderNetworkEdges();
  if (phases.includes('p4') || phases.includes('all')) seedEmployerPilot();

  console.log('\n✅ P0 seed complete.');
  console.log('   Navigation clinic_id:', clinicId);
  console.log('   Metro entity id:     ', METRO_ENTITY_ID);
  console.log('   Providers seeded:    ', PROVIDERS.map((p) => p.specialty).join(', '));
  console.log('\nNext: npm run navigation:preflight');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  main,
  seedNavigationTenant,
  seedMetroHealthPlus,
  seedProviders,
  seedProviderNetworkEdges,
  seedEmployerPilot,
  addAvailabilityBlocks,
};
