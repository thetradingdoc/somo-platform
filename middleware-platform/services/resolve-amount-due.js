'use strict';

const db = require('../database');
const { computeVisitQuote } = require('./payer-quote-service');

const VALID_STATUS = new Set(['hard_number', 'estimate', 'cannot_determine', 'thin', 'self_pay', 'defer']);

/**
 * Single source of truth for patient amount due at checkout / on call.
 * Precedence: Stedi 271 hard copay → plan_rules hard_number → journey amount_due → defer (never visit_pricing for insured).
 */
async function resolveAmountDue({ patientId, appointmentId, sessionId, payerId, planId, serviceCode, tenantSpecialty, providerId, locationId } = {}) {
  const base = {
    amount: 0,
    source: 'none',
    status: 'cannot_determine',
    copay_due_now: 0,
    covered: false,
    notes: null
  };

  if (!patientId && !sessionId) {
    return { ...base, notes: 'patient_or_session_required' };
  }

  if (providerId || locationId) {
    return {
      ...base,
      status: 'defer',
      source: 'provider_location',
      notes: 'provider_location_out_of_scope',
      message_key: 'PROVIDER_LOCATION_DEFER'
    };
  }

  const { classifyPayerContext } = require('./payer-class-routing');
  const payerClass = classifyPayerContext({ payerId, planId, tenantSpecialty });
  if (!payerClass.ok) {
    return {
      ...base,
      status: 'cannot_determine',
      source: 'payer_class',
      notes: payerClass.error_code,
      message_key: payerClass.message_key
    };
  }

  let eligibilityRow = null;
  if (patientId && db.db) {
    eligibilityRow = db.db
      .prepare(
        `SELECT id, copay_amount, eligible, payer_id, service_code, plan_summary,
                eligibility_quality, created_at
         FROM eligibility_checks
         WHERE patient_id = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(patientId);
  }

  if (eligibilityRow) {
    const quality = String(eligibilityRow.eligibility_quality || '').toLowerCase();
    if (quality === 'simulate') {
      // M-01/M-02: plan_rules wins over simulate; CDT codes never use flat simulate copay
      const simCode = serviceCode || eligibilityRow.service_code;
      if (simCode && /^D\d{4}$/i.test(String(simCode))) {
        // fall through to plan_rules with spine CDT
      }
    } else {
    const copay = Number(eligibilityRow.copay_amount);
    const hasHardCopay =
      quality === 'hard_copay' ||
      (eligibilityRow.eligible && !Number.isNaN(copay) && quality !== 'thin');

    if (hasHardCopay || (eligibilityRow.eligible && copay >= 0 && quality !== 'thin' && quality !== 'inactive')) {
      const amount = Math.max(0, copay);
      return {
        amount,
        copay_due_now: amount,
        source: 'eligibility_checks',
        status: amount === 0 && eligibilityRow.eligible ? 'hard_number' : 'hard_number',
        covered: eligibilityRow.eligible === 1 || eligibilityRow.eligible === true,
        eligibility_id: eligibilityRow.id,
        payer_id: eligibilityRow.payer_id || payerId || null,
        service_code: eligibilityRow.service_code || serviceCode || null
      };
    }

    if (quality === 'thin' || quality === 'inactive') {
      return {
        ...base,
        source: 'eligibility_checks',
        status: quality === 'thin' ? 'thin' : 'cannot_determine',
        notes: 'thin_271_defer',
        payer_id: eligibilityRow.payer_id
      };
    }
    }
  }

  const cpt = serviceCode || eligibilityRow?.service_code;
  const resolvedPayer = payerId || eligibilityRow?.payer_id;
  let resolvedPlan = planId;
  if (!resolvedPlan && eligibilityRow?.plan_summary) {
    try {
      const ps = typeof eligibilityRow.plan_summary === 'string'
        ? JSON.parse(eligibilityRow.plan_summary)
        : eligibilityRow.plan_summary;
      resolvedPlan = ps?.plan_id || ps?.planId || null;
    } catch (_) {}
  }
  resolvedPlan = resolvedPlan || 'dental_ppo';

  if (resolvedPayer && cpt) {
    const quote = await computeVisitQuote({
      primary_icd10: 'Z01.20',
      primary_cpt: cpt,
      payer_id: resolvedPayer,
      plan_id: resolvedPlan,
      session_id: sessionId
    });
    if (quote.status === 'hard_number') {
      return {
        amount: Number(quote.copay_due_now) || 0,
        copay_due_now: Number(quote.copay_due_now) || 0,
        source: 'plan_rules',
        status: 'hard_number',
        covered: quote.covered,
        quote
      };
    }
    if (quote.status === 'estimate') {
      return {
        amount: Number(quote.copay_due_now) || 0,
        copay_due_now: Number(quote.copay_due_now) || 0,
        source: 'plan_rules',
        status: 'estimate',
        covered: quote.covered,
        quote,
        notes: 'plan_rules_estimate_only'
      };
    }
  }

  if (appointmentId && db.db) {
    try {
      const journey = db.db
        .prepare(
          `SELECT amount_due FROM rcm_journeys
           WHERE appointment_id = ? OR id = ?
           ORDER BY updated_at DESC LIMIT 1`
        )
        .get(appointmentId, appointmentId);
      if (journey?.amount_due != null) {
        const amount = Number(journey.amount_due);
        return {
          amount,
          copay_due_now: amount,
          source: 'rcm_journeys',
          status: 'hard_number',
          covered: true
        };
      }
    } catch (_) {}
  }

  return base;
}

/**
 * Patient portal checkout amount — voice checkout row → resolveAmountDue → visit_pricing (self-pay only).
 * Insured thin/estimate responses block checkout (no visit_pricing fallback).
 */
async function resolvePatientCheckoutAmount({
  patientId,
  appointmentId,
  voiceCheckoutAmount,
  clinicId,
  appointmentType
} = {}) {
  let amount = null;
  if (voiceCheckoutAmount != null) {
    const parsed = parseFloat(voiceCheckoutAmount);
    if (Number.isFinite(parsed) && parsed > 0) amount = parsed;
  }

  const amountDue = await resolveAmountDue({ patientId, appointmentId });

  if ((!Number.isFinite(amount) || amount <= 0) && amountDue.status === 'hard_number') {
    amount = amountDue.amount;
  }

  if ((!Number.isFinite(amount) || amount <= 0) && (amountDue.status === 'thin' || amountDue.status === 'estimate')) {
    return {
      ok: false,
      error: 'amount_pending_verification',
      message: 'Coverage amount is not yet confirmed. We will text your confirmed amount before your visit.',
      amountDue,
      amount: null
    };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    const hasInsuredDefer =
      amountDue.source === 'eligibility_checks' &&
      amountDue.status !== 'hard_number' &&
      amountDue.status !== 'cannot_determine';
    if (hasInsuredDefer) {
      return {
        ok: false,
        error: 'amount_pending_verification',
        message: 'Coverage amount is not yet confirmed. We will text your confirmed amount before your visit.',
        amountDue,
        amount: null
      };
    }

    try {
      const pricing = db.getEffectiveVisitPrice(clinicId, appointmentType || 'General Consult');
      const officeFee = pricing?.effective_price != null ? parseFloat(pricing.effective_price) : null;
      if (Number.isFinite(officeFee) && officeFee > 0) {
        amount = officeFee;
        return {
          ok: true,
          amount,
          amountDue: { ...amountDue, source: 'visit_pricing', status: 'self_pay' }
        };
      }
    } catch (_) {}
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'unable_to_resolve_price', amountDue, amount: null };
  }

  return { ok: true, amount, amountDue };
}

/**
 * Unified checkout amount for voice/RCM payment rails.
 * Caller-provided amount wins when > 0; else resolveAmountDue (hard_number required by default).
 */
async function resolveCheckoutAmount({
  amount,
  patientId,
  appointmentId,
  sessionId,
  journeyId,
  requireHardNumber = true
} = {}) {
  const hinted = amount != null ? Number(amount) : null;
  if (Number.isFinite(hinted) && hinted >= 0) {
    const amountDue = await resolveAmountDue({ patientId, appointmentId, sessionId });
    return { ok: true, amount: hinted, amountDue, source: 'caller_hint' };
  }

  const amountDue = await resolveAmountDue({ patientId, appointmentId, sessionId });
  if (amountDue.status === 'hard_number') {
    return { ok: true, amount: amountDue.amount, amountDue, source: amountDue.source };
  }

  if (amountDue.status === 'thin' || amountDue.status === 'estimate') {
    return {
      ok: false,
      error: 'amount_pending_verification',
      message:
        'Coverage amount is not yet confirmed. We will text your confirmed amount before your visit.',
      amountDue
    };
  }

  if (journeyId && db.db) {
    try {
      const journey = db.db
        .prepare(`SELECT amount_due FROM rcm_journeys WHERE id = ? LIMIT 1`)
        .get(String(journeyId));
      const jAmt = journey?.amount_due != null ? Number(journey.amount_due) : null;
      if (Number.isFinite(jAmt) && jAmt > 0) {
        return {
          ok: true,
          amount: jAmt,
          amountDue: { ...amountDue, source: 'rcm_journeys', status: 'hard_number', amount: jAmt },
          source: 'rcm_journeys'
        };
      }
    } catch (_) {}
  }

  if (requireHardNumber) {
    return {
      ok: false,
      error: 'quote_required',
      message: 'I need to confirm your coverage amount before we can take payment.',
      amountDue
    };
  }

  return { ok: false, error: 'unable_to_resolve_price', amountDue };
}

function logAmountResolution(entry = {}) {
  if (!db.db) return null;
  try {
    const id = entry.id || require('uuid').v4();
    db.db.prepare(`
      INSERT INTO amount_resolution_log (
        id, patient_id, appointment_id, session_id,
        quoted_amount, charged_amount, source, status, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      entry.patient_id || null,
      entry.appointment_id || null,
      entry.session_id || null,
      entry.quoted_amount ?? null,
      entry.charged_amount ?? null,
      entry.source || null,
      entry.status || null,
      JSON.stringify(entry.details || {})
    );
    return id;
  } catch (e) {
    console.warn('[resolveAmountDue] log failed:', e.message);
    return null;
  }
}

module.exports = {
  resolveAmountDue,
  resolvePatientCheckoutAmount,
  resolveCheckoutAmount,
  logAmountResolution,
  VALID_STATUS
};
