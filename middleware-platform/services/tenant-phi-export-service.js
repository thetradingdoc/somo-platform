'use strict';

const db = require('../database');
const tenantHealth = require('./tenant-health');

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `***-***-${digits.slice(-4)}`;
}

function maskEmail(email) {
  const s = String(email || '').trim();
  const at = s.indexOf('@');
  if (at < 1) return null;
  return `${s[0]}***${s.slice(at)}`;
}

function redactPatient(row) {
  if (!row) return null;
  return {
    resource_id: row.resource_id,
    name: row.name || null,
    phone_masked: maskPhone(row.phone),
    email_masked: maskEmail(row.email),
    profile_verified: row.profile_verified === 1,
    insurance_verified: row.insurance_verified === 1,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function redactEligibility(row) {
  if (!row) return null;
  return {
    id: row.id,
    patient_id: row.patient_id,
    payer_id: row.payer_id,
    service_code: row.service_code,
    date_of_service: row.date_of_service,
    eligible: row.eligible === 1 || row.eligible === true,
    copay_amount: row.copay_amount,
    allowed_amount: row.allowed_amount,
    eligibility_quality: row.eligibility_quality || null,
    plan_summary: row.plan_summary || null,
    created_at: row.created_at
  };
}

function redactCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    email_masked: maskEmail(customer.email),
    company_name: customer.company_name || customer.name || null,
    plan_tier: customer.plan_tier,
    subscription_status: customer.subscription_status,
    customer_type: customer.customer_type,
    created_at: customer.created_at
  };
}

function redactTriageSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    session_id: row.session_id,
    patient_id: row.patient_id || null,
    onset: row.onset || null,
    provocation: row.provocation || null,
    quality: row.quality || null,
    radiation: row.radiation || null,
    severity: row.severity ?? null,
    timing: row.timing || null,
    associated_sx: row.associated_sx || null,
    safety_level: row.safety_level || null,
    urgency: row.urgency || null,
    target_specialty: row.target_specialty || null,
    opqrst_complete: row.opqrst_complete === 1,
    triage_complete: row.triage_complete === 1,
    referred_to_911: row.referred_to_911 === 1,
    detected_language: row.detected_language || null,
    clinic_id: row.clinic_id || null,
    customer_id: row.customer_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function redactConversationTurn(row) {
  if (!row) return null;
  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content: row.content,
    created_at: row.created_at
  };
}

function redactHealthTranscript(row) {
  if (!row) return null;
  return {
    id: row.id,
    session_id: row.session_id,
    room_id: row.room_id,
    speaker: row.speaker,
    text: row.text,
    source: row.source || null,
    ts: row.ts,
    created_at: row.created_at
  };
}

function tableExists(tableName) {
  if (!db.db) return false;
  const row = db.db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName);
  return Boolean(row);
}

function tenantSessionIds(customerId, clinicId) {
  if (!db.db || !customerId) return [];
  const rows = db.db
    .prepare(
      `SELECT DISTINCT call_id AS session_id FROM voice_call_log
       WHERE customer_id = ? OR clinic_id = ?
       ORDER BY created_at DESC LIMIT 10000`
    )
    .all(customerId, clinicId);
  return rows.map((r) => r.session_id).filter(Boolean);
}

/**
 * Build tenant-scoped PHI export bundle for offboarding (portability + redacted summaries).
 * @param {string} clinicId
 * @returns {object|null}
 */
function buildTenantPhiExport(clinicId) {
  if (!db.db) return null;
  const clinic = db.db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (!clinic) return null;

  const customerId = tenantHealth.resolveTenantCustomerId(clinicId);
  const customer = customerId && db.getCustomer ? db.getCustomer(customerId) : null;
  const merchantId = clinic.merchant_id || customer?.merchant_id || null;

  let patients = [];
  if (merchantId && db.db) {
    patients = db.db
      .prepare(
        `SELECT resource_id, name, phone, email, profile_verified, insurance_verified, created_at, updated_at
         FROM fhir_patients WHERE merchant_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`
      )
      .all(merchantId)
      .map(redactPatient);
  }

  const patientIds = patients.map((p) => p.resource_id).filter(Boolean);
  let eligibility = [];
  if (patientIds.length && db.db) {
    const placeholders = patientIds.map(() => '?').join(',');
    eligibility = db.db
      .prepare(
        `SELECT id, patient_id, payer_id, service_code, date_of_service, eligible, copay_amount,
                allowed_amount, eligibility_quality, plan_summary, created_at
         FROM eligibility_checks WHERE patient_id IN (${placeholders})
         ORDER BY created_at DESC LIMIT 5000`
      )
      .all(...patientIds)
      .map(redactEligibility);
  }

  let calls = [];
  let functionCalls = [];
  let eligibilityUsage = [];
  let monthlyUsage = [];
  let triageSessions = [];
  let conversationHistory = [];
  let healthTranscripts = [];

  if (db.db && customerId) {
    calls = db.db
      .prepare(
        `SELECT id, call_id, call_duration_seconds, call_duration_minutes, status, caller_label,
                caller_phone, outcome, created_at
         FROM voice_call_log WHERE customer_id = ? OR clinic_id = ?
         ORDER BY created_at DESC LIMIT 5000`
      )
      .all(customerId, clinicId)
      .map((c) => ({
        ...c,
        caller_phone: maskPhone(c.caller_phone)
      }));

    functionCalls = db.db
      .prepare(
        `SELECT id, call_id, function_name, success, created_at
         FROM function_call_log WHERE customer_id = ?
         ORDER BY created_at DESC LIMIT 5000`
      )
      .all(customerId);

    eligibilityUsage = db.db
      .prepare(
        `SELECT event_date, payer_id, source, quality, created_at
         FROM eligibility_usage_events WHERE customer_id = ?
         ORDER BY created_at DESC LIMIT 5000`
      )
      .all(customerId);

    monthlyUsage = db.getAllMonthlyUsage ? db.getAllMonthlyUsage(customerId) : [];

    if (tableExists('triage_sessions')) {
      const triageCols = db.db.prepare(`PRAGMA table_info(triage_sessions)`).all();
      const hasClinic = triageCols.some((c) => c.name === 'clinic_id');
      const hasCustomer = triageCols.some((c) => c.name === 'customer_id');
      if (hasClinic && hasCustomer) {
        triageSessions = db.db
          .prepare(
            `SELECT id, session_id, patient_id, onset, provocation, quality, radiation, severity, timing,
                    associated_sx, safety_level, urgency, target_specialty, opqrst_complete, triage_complete,
                    referred_to_911, detected_language, clinic_id, customer_id, created_at, updated_at
             FROM triage_sessions
             WHERE clinic_id = ? OR customer_id = ?
             ORDER BY created_at DESC LIMIT 5000`
          )
          .all(clinicId, customerId)
          .map(redactTriageSession);
      } else {
        const sessionIds = tenantSessionIds(customerId, clinicId);
        if (sessionIds.length) {
          const placeholders = sessionIds.map(() => '?').join(',');
          triageSessions = db.db
            .prepare(
              `SELECT * FROM triage_sessions WHERE session_id IN (${placeholders})
               ORDER BY created_at DESC LIMIT 5000`
            )
            .all(...sessionIds)
            .map(redactTriageSession);
        }
      }
    }

    if (tableExists('kelly_conversation_history')) {
      const sessionIds = tenantSessionIds(customerId, clinicId);
      if (sessionIds.length) {
        const placeholders = sessionIds.map(() => '?').join(',');
        conversationHistory = db.db
          .prepare(
            `SELECT id, session_id, role, content, created_at
             FROM kelly_conversation_history
             WHERE session_id IN (${placeholders})
             ORDER BY created_at ASC LIMIT 50000`
          )
          .all(...sessionIds)
          .map(redactConversationTurn);
      }
    }

    if (tableExists('health_session_transcripts')) {
      const sessionIds = tenantSessionIds(customerId, clinicId);
      if (sessionIds.length) {
        const placeholders = sessionIds.map(() => '?').join(',');
        healthTranscripts = db.db
          .prepare(
            `SELECT id, session_id, room_id, speaker, text, source, ts, created_at
             FROM health_session_transcripts
             WHERE session_id IN (${placeholders})
             ORDER BY ts ASC LIMIT 50000`
          )
          .all(...sessionIds)
          .map(redactHealthTranscript);
      }
    }
  }

  return {
    export_version: '2',
    exported_at: new Date().toISOString(),
    clinic: {
      clinic_id: clinic.clinic_id,
      name: clinic.name,
      slug: clinic.slug,
      merchant_id: merchantId,
      archived_at: clinic.archived_at || null,
      is_active: clinic.is_active
    },
    customer: redactCustomer(customer),
    counts: {
      patients: patients.length,
      eligibility_checks: eligibility.length,
      voice_calls: calls.length,
      function_calls: functionCalls.length,
      eligibility_usage_events: eligibilityUsage.length,
      triage_sessions: triageSessions.length,
      conversation_turns: conversationHistory.length,
      health_transcripts: healthTranscripts.length
    },
    patients,
    eligibility_checks: eligibility,
    voice_calls: calls,
    function_calls: functionCalls,
    eligibility_usage_events: eligibilityUsage,
    monthly_usage: monthlyUsage,
    triage_sessions: triageSessions,
    conversation_history: conversationHistory,
    health_session_transcripts: healthTranscripts,
    redaction_policy: 'tenant_portability_export_v2'
  };
}

module.exports = {
  buildTenantPhiExport,
  maskPhone,
  maskEmail,
  redactPatient,
  redactEligibility,
  redactTriageSession,
  redactConversationTurn,
  redactHealthTranscript
};
