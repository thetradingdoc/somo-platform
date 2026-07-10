'use strict';

/**
 * Resolve inbound platform line caller — sales lead vs tenant vs unknown.
 */

const SMSService = require('./sms-service');

function normalizePhoneDigits(phone) {
  if (!phone) return '';
  try {
    const formatted = SMSService.formatPhoneNumber(String(phone).trim());
    return String(formatted).replace(/\D/g, '');
  } catch {
    return String(phone).replace(/\D/g, '');
  }
}

function phoneSqlMatch(digits) {
  if (!digits || digits.length < 10) return null;
  const last10 = digits.slice(-10);
  return { digits, last10 };
}

function findLeadByPhone(db, phone) {
  const match = phoneSqlMatch(normalizePhoneDigits(phone));
  if (!match) return null;
  try {
    const rows = db.db
      .prepare(
        `SELECT id, clinic_name, pipeline_stage, source
         FROM leads
         WHERE (is_test IS NULL OR is_test = 0)
           AND clinic_phone IS NOT NULL
           AND TRIM(clinic_phone) != ''
         ORDER BY updated_at DESC
         LIMIT 500`
      )
      .all();
    for (const row of rows) {
      const leadDigits = normalizePhoneDigits(row.clinic_phone);
      if (leadDigits.slice(-10) === match.last10) return row;
    }
  } catch (_) {}
  return null;
}

function findTenantByPhone(db, phone) {
  const match = phoneSqlMatch(normalizePhoneDigits(phone));
  if (!match) return null;
  try {
    const byTwilio = db.getCustomerByTwilioNumber?.(phone) || db.getCustomerByPhone?.(phone);
    if (byTwilio && byTwilio.customer_type !== 'operator' && byTwilio.customer_type !== 'navigation') {
      return byTwilio;
    }
    const rows = db.db
      .prepare(
        `SELECT id, name, email, customer_type, phone_number, twilio_phone_number, status
         FROM customers
         WHERE customer_type NOT IN ('operator', 'navigation')
           AND (status IS NULL OR status != 'archived')
         LIMIT 500`
      )
      .all();
    for (const row of rows) {
      for (const field of [row.phone_number, row.twilio_phone_number]) {
        const d = normalizePhoneDigits(field);
        if (d && d.slice(-10) === match.last10) return row;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * @returns {{ caller_type: 'sales_lead'|'tenant'|'unknown', lead_id?: string, tenant_customer_id?: string, clinic_name?: string, tenant_name?: string }}
 */
function resolvePlatformCallerContext(db, fromPhone) {
  const tenant = findTenantByPhone(db, fromPhone);
  if (tenant) {
    return {
      caller_type: 'tenant',
      tenant_customer_id: tenant.id,
      tenant_name: tenant.name || null
    };
  }
  const lead = findLeadByPhone(db, fromPhone);
  if (lead) {
    return {
      caller_type: 'sales_lead',
      lead_id: lead.id,
      clinic_name: lead.clinic_name || null,
      lead_source: lead.source || null
    };
  }
  return { caller_type: 'unknown' };
}

/**
 * Create or update inbound_platform lead after qualifying call.
 */
function ensureInboundPlatformLead(db, opts = {}) {
  const phone = opts.phone || opts.caller_phone;
  if (!phone) return null;
  const existing = findLeadByPhone(db, phone);
  if (existing) return existing;

  const id = `lead_${require('crypto').randomBytes(12).toString('hex')}`;
  const notes = opts.notes ? String(opts.notes).trim() : null;
  db.createLead({
    id,
    clinic_name: opts.clinic_name || 'Inbound platform caller',
    clinic_phone: phone,
    source: 'inbound_platform',
    outbound_consent_basis: 'inbound_platform',
    consent_recorded_at: new Date().toISOString(),
    pipeline_stage: 'new',
    notes: notes || 'Created from inbound platform support call',
    lead_type: 'sales'
  });
  return db.getLead(id);
}

module.exports = {
  normalizePhoneDigits,
  findLeadByPhone,
  findTenantByPhone,
  resolvePlatformCallerContext,
  ensureInboundPlatformLead
};
