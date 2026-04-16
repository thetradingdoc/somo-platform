'use strict';

const db = require('../database');

const DEFAULT_INVENTORY = [
  {
    system_name: 'middleware-platform',
    data_domain: 'payments',
    dataset_name: 'financial_events',
    contains_phi: false,
    contains_pii: true,
    privacy_tier: 'internal_sensitive',
    retention_days: 2555,
    owner: 'security-compliance',
    access_roles: ['admin_finance', 'admin_security'],
    redaction_policy: 'mask_email_last4,mask_phone_last4,no_full_card'
  },
  {
    system_name: 'middleware-platform',
    data_domain: 'payments',
    dataset_name: 'reconciliation_exceptions',
    contains_phi: false,
    contains_pii: false,
    privacy_tier: 'internal',
    retention_days: 1095,
    owner: 'finance-ops',
    access_roles: ['admin_finance'],
    redaction_policy: 'no_customer_plaintext'
  },
  {
    system_name: 'middleware-platform',
    data_domain: 'impact',
    dataset_name: 'impact_ledger_events',
    contains_phi: false,
    contains_pii: true,
    privacy_tier: 'internal_sensitive',
    retention_days: 1825,
    owner: 'impact-governance',
    access_roles: ['admin_impact', 'admin_security'],
    redaction_policy: 'aggregate_only_public_output'
  },
  {
    system_name: 'middleware-platform',
    data_domain: 'identity',
    dataset_name: 'fhir_patients',
    contains_phi: true,
    contains_pii: true,
    privacy_tier: 'restricted_phi',
    retention_days: 3650,
    owner: 'security-compliance',
    access_roles: ['admin_clinical', 'admin_security'],
    redaction_policy: 'strict_phi_redaction_export'
  }
];

function seedDefaultDataInventory() {
  const out = [];
  for (const item of DEFAULT_INVENTORY) {
    const row = db.upsertDataInventoryItem(item);
    if (row) out.push(row);
  }
  return out;
}

function runRetentionSweep() {
  const inv = db.listDataInventory(1000);
  const summary = { checked: inv.length, jobs: [] };
  const deletionEnabled = String(process.env.RETENTION_DELETE_ENABLED || '1') !== '0';
  const deletionHandlers = {
    financial_events: (cutoff) => {
      try {
        const r = db.db.prepare(`DELETE FROM financial_events WHERE datetime(created_at) < datetime(?)`).run(cutoff);
        return Number(r?.changes || 0);
      } catch (_) {
        return 0;
      }
    },
    impact_ledger_events: (cutoff) => {
      try {
        const r = db.db.prepare(`
          DELETE FROM impact_ledger_events
          WHERE datetime(created_at) < datetime(?)
            AND verification_state != 'verified'
        `).run(cutoff);
        return Number(r?.changes || 0);
      } catch (_) {
        return 0;
      }
    },
    secret_access_audit: (cutoff) => {
      try {
        const r = db.db.prepare(`DELETE FROM secret_access_audit WHERE datetime(created_at) < datetime(?)`).run(cutoff);
        return Number(r?.changes || 0);
      } catch (_) {
        return 0;
      }
    }
  };
  for (const row of inv) {
    const days = Number(row.retention_days || 0);
    if (!Number.isFinite(days) || days <= 0) continue;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const handler = deletionHandlers[row.dataset_name];
    const deleted = deletionEnabled && typeof handler === 'function' ? handler(cutoff) : 0;
    const job = db.createDataRetentionJob({
      dataset_name: row.dataset_name,
      cutoff_at: cutoff,
      status: 'completed',
      records_deleted: deleted,
      error_message: null
    });
    if (job) summary.jobs.push(job);
  }
  return summary;
}

module.exports = {
  seedDefaultDataInventory,
  runRetentionSweep
};

