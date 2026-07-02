#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.chdir(require('path').join(__dirname, '..'));

const db = require('../database');
const { resolveTenantVoiceConfig } = require('../services/tenant-voice-config');

/** Phase 1 gap report — SaaS/front-desk tenants only (not navigation/api demos). */
const SAAS_CUSTOMER_TYPES = new Set(['tenant', 'saas', 'healthcare_provider', null]);

const customers = db.db.prepare(`
  SELECT id, customer_type, name, company_name FROM customers
  WHERE merchant_id IS NOT NULL
    AND (customer_type IS NULL OR customer_type NOT IN ('operator'))
`).all();

const gaps = [];
let skipped = 0;
for (const row of customers) {
  if (row.customer_type && !SAAS_CUSTOMER_TYPES.has(row.customer_type)) {
    skipped++;
    continue;
  }
  const cfg = resolveTenantVoiceConfig(db, { customerId: row.id });
  if (!cfg.config_status?.ready) {
    gaps.push({
      customer_id: row.id,
      customer_type: row.customer_type || 'tenant',
      clinic_id: cfg.clinic_id,
      clinic_name: cfg.clinic_name || row.company_name || row.name,
      missing: cfg.config_status.missing
    });
  }
}

console.log(
  JSON.stringify({ total: customers.length, saas_checked: customers.length - skipped, skipped, incomplete: gaps.length, tenants: gaps }, null, 2)
);
process.exit(gaps.length ? 1 : 0);
