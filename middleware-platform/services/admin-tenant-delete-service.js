'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const tenantHealth = require('./tenant-health');

/** Names/slugs safe for hard delete (seed / duplicate test clinics). */
const HARD_DELETE_NAME_ALLOWLIST = [
  'default clinic',
  'somo health navigator',
];

const HARD_DELETE_SLUG_ALLOWLIST = [
  'default-clinic',
  'default',
  'somo-health-navigator',
];

function isArchived(clinic) {
  return !!(clinic?.archived_at && String(clinic.archived_at).trim());
}

function matchesHardDeleteAllowlist(clinic) {
  const name = (clinic.name || '').toLowerCase().trim();
  const slug = (clinic.slug || '').toLowerCase().trim();
  return HARD_DELETE_NAME_ALLOWLIST.some((n) => name.includes(n))
    || HARD_DELETE_SLUG_ALLOWLIST.includes(slug);
}

function resolveCustomerId(clinicId) {
  return tenantHealth.resolveTenantCustomerId(clinicId);
}

function buildSnapshot(clinicId) {
  const clinic = db.db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (!clinic) return null;
  const customerId = resolveCustomerId(clinicId);
  const credits = customerId ? db.getCustomerCredits(customerId) : null;
  const phoneCount = db.db.prepare(
    'SELECT COUNT(*) as n FROM clinic_phone_numbers WHERE clinic_id = ?'
  ).get(clinicId)?.n || 0;
  return {
    clinic_id: clinic.clinic_id,
    name: clinic.name,
    slug: clinic.slug,
    retell_agent_id: clinic.retell_agent_id,
    is_active: clinic.is_active,
    archived_at: clinic.archived_at || null,
    credits_balance_minutes: credits?.credits_balance_minutes ?? 0,
    phone_numbers: phoneCount,
  };
}

function writeAudit(clinicId, clinicName, deletedBy, mode, snapshot) {
  db.db.prepare(`
    INSERT INTO admin_tenant_deletions (id, clinic_id, clinic_name, deleted_by, mode, snapshot_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    clinicId,
    clinicName || null,
    deletedBy || 'admin',
    mode,
    JSON.stringify(snapshot || {})
  );
}

function hasProductionBillingActivity(clinicId, customerId) {
  if (!customerId) return false;
  const credits = db.getCustomerCredits(customerId);
  const paidUsed = credits?.paid_credits_used || 0;
  const paidPurchased = credits?.paid_credits_purchased || 0;
  if (paidUsed > 0 || paidPurchased > 0) return true;
  const callCount = db.db.prepare(`
    SELECT COUNT(*) as n FROM voice_call_log WHERE customer_id = ? OR clinic_id = ?
  `).get(customerId, clinicId)?.n || 0;
  return callCount > 10;
}

function canHardDelete(clinic, { force = false } = {}) {
  if (!clinic) return { allowed: false, reason: 'Tenant not found' };
  if (isArchived(clinic)) return { allowed: true, reason: 'already_archived' };
  if (matchesHardDeleteAllowlist(clinic)) return { allowed: true, reason: 'allowlist' };
  if (force) {
    const customerId = resolveCustomerId(clinic.clinic_id);
    if (hasProductionBillingActivity(clinic.clinic_id, customerId)) {
      return { allowed: false, reason: 'Tenant has billing/call history — archive first' };
    }
    return { allowed: true, reason: 'force' };
  }
  return {
    allowed: false,
    reason: 'Hard delete only allowed for archived tenants or seed/test clinics',
  };
}

function getDeleteOptions(clinic) {
  if (!clinic) return { can_hard_delete: false, is_archived: false };
  const hard = canHardDelete(clinic);
  return {
    is_archived: isArchived(clinic),
    can_hard_delete: hard.allowed,
    hard_delete_reason: hard.reason,
  };
}

function softDelete(clinicId, deletedBy = 'admin') {
  const clinic = db.db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (!clinic) {
    const err = new Error('Tenant not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (isArchived(clinic)) {
    return { already_archived: true, clinic_id: clinicId };
  }
  const snapshot = buildSnapshot(clinicId);
  db.db.prepare(`
    UPDATE clinics
    SET archived_at = datetime('now'),
        archived_by = ?,
        is_active = 0,
        retell_agent_status = 'archived',
        updated_at = datetime('now')
    WHERE clinic_id = ?
  `).run(deletedBy, clinicId);
  writeAudit(clinicId, clinic.name, deletedBy, 'soft', snapshot);
  return { mode: 'soft', clinic_id: clinicId, clinic_name: clinic.name };
}

function tableExists(name) {
  const row = db.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(name);
  return !!row;
}

function purgeClinicDependencies(clinicId) {
  const deleteTables = [
    'stripe_card_transactions',
    'stripe_cards',
    'stripe_cardholders',
    'visit_pricing',
    'clinic_phone_numbers',
    'customer_clinics',
  ];
  for (const table of deleteTables) {
    if (tableExists(table)) {
      db.db.prepare(`DELETE FROM ${table} WHERE clinic_id = ?`).run(clinicId);
    }
  }
  const nullClinicTables = [
    'voice_call_log',
    'fhir_patients',
    'appointments',
    'voice_agent_settings',
    'kelly_call_events',
    'triage_sessions',
  ];
  for (const table of nullClinicTables) {
    if (tableExists(table)) {
      db.db.prepare(`UPDATE ${table} SET clinic_id = NULL WHERE clinic_id = ?`).run(clinicId);
    }
  }
}

function hardDelete(clinicId, deletedBy = 'admin', { force = false } = {}) {
  const clinic = db.db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (!clinic) {
    const err = new Error('Tenant not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const gate = canHardDelete(clinic, { force });
  if (!gate.allowed) {
    const err = new Error(gate.reason);
    err.code = 'HARD_DELETE_BLOCKED';
    throw err;
  }
  const snapshot = buildSnapshot(clinicId);
  const purge = db.db.transaction(() => {
    purgeClinicDependencies(clinicId);
    db.db.prepare('DELETE FROM clinics WHERE clinic_id = ?').run(clinicId);
  });
  purge();
  writeAudit(clinicId, clinic.name, deletedBy, 'hard', snapshot);
  return { mode: 'hard', clinic_id: clinicId, clinic_name: clinic.name };
}

module.exports = {
  HARD_DELETE_NAME_ALLOWLIST,
  softDelete,
  hardDelete,
  canHardDelete,
  getDeleteOptions,
  isArchived,
  matchesHardDeleteAllowlist,
  buildSnapshot,
  purgeClinicDependencies,
  tableExists,
};
