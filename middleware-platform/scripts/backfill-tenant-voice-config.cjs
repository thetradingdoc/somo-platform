#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.chdir(require('path').join(__dirname, '..'));

const db = require('../database');
const { ensureCustomerClinicLink, resolveTenantVoiceConfig } = require('../services/tenant-voice-config');
const { seedPromptProfile, seedVoiceAgentSettings } = require('../services/saas-tenant-provision');

const SAAS_CUSTOMER_TYPES = new Set(['tenant', 'saas', 'healthcare_provider', null]);

function resolveClinicIdForCustomer(customerId, merchantId) {
  const viaCc = db.db
    .prepare(
      `SELECT c.clinic_id FROM customer_clinics cc
       JOIN clinics c ON c.clinic_id = cc.clinic_id
       WHERE cc.customer_id = ? AND c.is_active = 1
       ORDER BY cc.is_primary DESC, c.created_at ASC
       LIMIT 1`
    )
    .get(customerId);
  if (viaCc?.clinic_id) return viaCc.clinic_id;

  if (merchantId) {
    const viaMerchant = db.db
      .prepare('SELECT clinic_id FROM clinics WHERE merchant_id = ? AND is_active = 1 LIMIT 1')
      .get(merchantId);
    if (viaMerchant?.clinic_id) return viaMerchant.clinic_id;
  }
  return null;
}

const customers = db.db.prepare(`
  SELECT c.id as customer_id, c.merchant_id, c.name, c.company_name, c.email, c.use_case, c.customer_type,
         c.retell_agent_id
  FROM customers c
  WHERE c.merchant_id IS NOT NULL
    AND (c.customer_type IS NULL OR c.customer_type NOT IN ('operator'))
`).all();

const report = { linked: 0, voice_seeded: 0, profiles_seeded: 0, clinics_patched: 0, skipped_non_saas: 0, incomplete: [] };

for (const row of customers) {
  if (row.customer_type && !SAAS_CUSTOMER_TYPES.has(row.customer_type)) {
    report.skipped_non_saas++;
    continue;
  }

  const clinicId = resolveClinicIdForCustomer(row.customer_id, row.merchant_id);
  if (!clinicId) {
    report.incomplete.push({ customer_id: row.customer_id, missing: ['clinic_id'] });
    continue;
  }

  if (ensureCustomerClinicLink(db, row.customer_id, clinicId, { isPrimary: true })) {
    report.linked++;
  }

  const clinic = db.db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (clinic && !clinic.email && row.email) {
    db.updateClinic(clinicId, { email: row.email });
    report.clinics_patched++;
  }

  const existingProfile = db.getClinicPromptProfile?.(clinicId, row.customer_id);
  if (!existingProfile) {
    seedPromptProfile(db, {
      clinicId,
      customerId: row.customer_id,
      useCase: row.use_case || 'healthcare_clinic',
      clinicName: row.company_name || row.name
    });
    report.profiles_seeded++;
  }

  const vas = db.getVoiceAgentSettingsForProvider?.({
    merchantId: row.merchant_id,
    customerId: row.customer_id,
    clinicId
  });
  if (!vas?.language_mode || !vas?.business_hours) {
    seedVoiceAgentSettings(db, {
      customerId: row.customer_id,
      merchantId: row.merchant_id,
      customer: db.getCustomer(row.customer_id),
      clinicName: row.company_name || row.name
    });
    report.voice_seeded++;
  }

  const cfg = resolveTenantVoiceConfig(db, {
    customerId: row.customer_id,
    clinicId,
    merchantId: row.merchant_id
  });
  if (!cfg.config_status?.ready) {
    report.incomplete.push({
      customer_id: row.customer_id,
      clinic_id: clinicId,
      name: row.company_name || row.name,
      missing: cfg.config_status?.missing || []
    });
  }
}

console.log(JSON.stringify(report, null, 2));
console.log(
  `\nDone. linked: ${report.linked}, profiles: ${report.profiles_seeded}, voice: ${report.voice_seeded}, clinic email patched: ${report.clinics_patched}, skipped non-SaaS: ${report.skipped_non_saas}`
);
console.log(`SaaS tenants with gaps: ${report.incomplete.length}`);
process.exit(report.incomplete.length ? 1 : 0);
