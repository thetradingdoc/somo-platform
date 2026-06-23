#!/usr/bin/env node
'use strict';

/**
 * Stamp tenant site-context rows so call-site-context resolves to verified.
 * Used by capstone preseed, upload preflight, and verify-tenant-site-context.cjs.
 */

const path = require('path');
const Database = require('better-sqlite3');
const { SiteContextStatus } = require('../../services/voice/call-site-context');

const VERDICT_SQL = `
SELECT
  cpn.phone_number,
  c.merchant_id AS clinic_merchant,
  cu.merchant_id AS customer_merchant,
  CASE
    WHEN cpn.phone_number IS NULL THEN 'FAIL: no DID row'
    WHEN c.merchant_id IS NULL OR cu.merchant_id IS NULL THEN 'FAIL: merchant_id missing'
    WHEN c.merchant_id = cu.merchant_id THEN 'PASS: verified bind'
    ELSE 'FAIL: merchant mismatch'
  END AS verdict
FROM clinic_phone_numbers cpn
JOIN clinics c ON c.clinic_id = cpn.clinic_id
JOIN customers cu ON cu.id = ?
WHERE cpn.phone_number = ?
`;

function merchantKeyForCustomer(customerId, existingMerchantId = null) {
  const existing = existingMerchantId != null ? String(existingMerchantId).trim() : '';
  if (existing) return existing;
  if (!customerId) return null;
  return `cust:${String(customerId).trim()}`;
}

function openDb(dbPathOrHandle) {
  if (dbPathOrHandle && typeof dbPathOrHandle.prepare === 'function') {
    return { db: dbPathOrHandle, owned: false };
  }
  const resolved = path.resolve(String(dbPathOrHandle));
  return { db: new Database(resolved), owned: true, path: resolved };
}

function closeDb(handle) {
  if (handle.owned) {
    try {
      handle.db.close();
    } catch (_) {}
  }
}

function runVerdictQuery(sqlite, { customerId, did }) {
  return sqlite.prepare(VERDICT_SQL).get(customerId, did);
}

function createDbAdapter(sqlite) {
  return {
    getClinicPhoneNumber: (phone) => {
      const digits = String(phone || '').replace(/\D/g, '');
      const candidates = [
        phone,
        digits ? `+${digits}` : null,
        digits.length === 10 ? `+1${digits}` : null
      ].filter(Boolean);
      const placeholders = candidates.map(() => '?').join(', ');
      return sqlite
        .prepare(
          `SELECT cpn.* FROM clinic_phone_numbers cpn
           JOIN clinics c ON cpn.clinic_id = c.clinic_id
           WHERE cpn.phone_number IN (${placeholders}) AND c.is_active = 1
           LIMIT 1`
        )
        .get(...candidates);
    },
    getCustomerIdForClinic: (clinicId) => {
      const joinRow = sqlite
        .prepare(
          `SELECT customer_id FROM customer_clinics WHERE clinic_id = ? ORDER BY is_primary DESC LIMIT 1`
        )
        .get(clinicId);
      if (joinRow?.customer_id) return joinRow.customer_id;
      const clinic = sqlite.prepare('SELECT merchant_id FROM clinics WHERE clinic_id = ?').get(clinicId);
      if (!clinic?.merchant_id) return null;
      const customer = sqlite
        .prepare('SELECT id FROM customers WHERE merchant_id = ? ORDER BY created_at ASC LIMIT 1')
        .get(clinic.merchant_id);
      return customer?.id || null;
    },
    getClinicById: (id) => sqlite.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(id),
    getClinic: (id) => sqlite.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(id),
    getCustomer: (id) => sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(id)
  };
}

/**
 * @param {string|import('better-sqlite3').Database} dbPathOrHandle
 * @param {{ customerId: string, clinicId: string, did: string, clinicName?: string }} opts
 */
function stampTenantSiteContext(dbPathOrHandle, opts = {}) {
  const { customerId, clinicId, did, clinicName = 'Default Clinic' } = opts;
  if (!customerId || !clinicId || !did) {
    throw new Error('stampTenantSiteContext requires customerId, clinicId, and did');
  }

  const handle = openDb(dbPathOrHandle);
  const { db: sqlite } = handle;
  try {
    const customer = sqlite.prepare('SELECT id, merchant_id FROM customers WHERE id = ?').get(customerId);
    if (!customer) {
      throw new Error(`customer not found: ${customerId}`);
    }

    const merchantKey = merchantKeyForCustomer(customerId, customer.merchant_id);
    if (!merchantKey) {
      throw new Error(`could not derive merchant key for ${customerId}`);
    }

    sqlite
      .prepare(
        `UPDATE customers SET merchant_id = ?
         WHERE id = ? AND (merchant_id IS NULL OR merchant_id = '')`
      )
      .run(merchantKey, customerId);
    sqlite.prepare(`UPDATE customers SET merchant_id = ? WHERE id = ?`).run(merchantKey, customerId);

    sqlite
      .prepare(
        `INSERT INTO clinics (clinic_id, name, slug, merchant_id, is_active)
         VALUES (?, ?, 'default', ?, 1)
         ON CONFLICT(clinic_id) DO UPDATE SET
           merchant_id = excluded.merchant_id,
           is_active = 1`
      )
      .run(clinicId, clinicName, merchantKey);

    sqlite
      .prepare(
        `INSERT OR REPLACE INTO clinic_phone_numbers (phone_number, clinic_id, is_primary, created_at)
         VALUES (?, ?, 1, datetime('now'))`
      )
      .run(did, clinicId);

    sqlite
      .prepare(
        `INSERT OR REPLACE INTO customer_clinics (customer_id, clinic_id, is_primary, created_at)
         VALUES (?, ?, 1, datetime('now'))`
      )
      .run(customerId, clinicId);

    return { merchantKey, customerId, clinicId, did };
  } finally {
    closeDb(handle);
  }
}

/**
 * @returns {{ verdict: string, row: object, siteContext: object, admission: object }}
 */
function evaluateTenantSiteContext(dbPathOrHandle, opts = {}) {
  const {
    customerId,
    clinicId,
    did,
    callType = 'tenant',
    direction = 'inbound'
  } = opts;
  const handle = openDb(dbPathOrHandle);
  const { db: sqlite } = handle;
  try {
    const row = runVerdictQuery(sqlite, { customerId, did });
    const { resolveCallSiteContext } = require('../../services/voice/call-site-context');
    const { evaluateIdentityAdmission } = require('../../services/voice/voice-identity-admission');
    const { isTenantResolvedForMode } = require('../../services/voice/voice-routing-world');

    const dbAdapter = createDbAdapter(sqlite);
    const siteContext = resolveCallSiteContext({
      db: dbAdapter,
      to_number: did,
      customer_id: customerId,
      clinic_id: clinicId,
      call_type: callType,
      direction
    });
    const admission = evaluateIdentityAdmission({
      clinicId,
      customerId,
      call_type: callType,
      direction,
      site_context_status: siteContext.site_context_status,
      tenantResolved: isTenantResolvedForMode(customerId)
    });

    return { verdict: row?.verdict || 'FAIL: no row', row, siteContext, admission };
  } finally {
    closeDb(handle);
  }
}

function assertSiteContextVerdict(dbPathOrHandle, opts = {}) {
  const result = evaluateTenantSiteContext(dbPathOrHandle, opts);
  const pass =
    result.verdict === 'PASS: verified bind' &&
    result.siteContext?.site_context_status === SiteContextStatus.VERIFIED &&
    result.admission?.admitted === true;

  if (!pass) {
    const msg = [
      `tenant site-context assert failed: verdict=${result.verdict}`,
      `site_context_status=${result.siteContext?.site_context_status}`,
      `admitted=${result.admission?.admitted}`,
      result.admission?.reason ? `reason=${result.admission.reason}` : null
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(msg);
  }
  return result;
}

function checkTenantSiteContextUploadPreflight(dbPath, opts = {}) {
  try {
    assertSiteContextVerdict(dbPath, opts);
    return null;
  } catch (e) {
    return e.message || 'tenant site-context preflight failed';
  }
}

module.exports = {
  VERDICT_SQL,
  merchantKeyForCustomer,
  stampTenantSiteContext,
  evaluateTenantSiteContext,
  assertSiteContextVerdict,
  checkTenantSiteContextUploadPreflight,
  runVerdictQuery
};
