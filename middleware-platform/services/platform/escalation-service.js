'use strict';

/**
 * Fail-closed escalation — PSTN transfer + audit (healthcare).
 */

const { handoffCopy } = require('../voice/voice-identity-admission');

function getOperatorFallbackPstn() {
  return (
    process.env.CALLSOMO_OPERATOR_FALLBACK_PSTN ||
    process.env.CALLSOMO_OPERATOR_TWILIO_NUMBER ||
    process.env.TWILIO_PHONE_NUMBER ||
    null
  );
}

function resolvePstnTarget(db, { clinicId, customerId } = {}) {
  if (clinicId && db?.getClinicById) {
    try {
      const clinic = db.getClinicById(clinicId) || db.getClinic?.(clinicId);
      if (clinic?.transfer_number) return { number: String(clinic.transfer_number), source: 'clinic_transfer' };
      if (clinic?.fallback_pstn) return { number: String(clinic.fallback_pstn), source: 'clinic_fallback' };
      if (clinic?.phone_number) return { number: String(clinic.phone_number), source: 'clinic_main' };
    } catch (_) {}
  }
  const ops = getOperatorFallbackPstn();
  if (ops) return { number: ops, source: 'operator_fallback' };
  return { number: null, source: 'none' };
}

function normalizeE164(num) {
  if (!num) return null;
  const s = String(num).trim();
  if (s.startsWith('+')) return s;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return s;
}

/**
 * Log handoff attempt and return action descriptor for WS / tools.
 */
function recordHandoffEscalation(db, payload = {}) {
  const row = {
    session_id: payload.sessionId || payload.session_id || null,
    call_id: payload.callId || payload.call_id || null,
    reason: payload.reason || 'handoff',
    pstn_target: payload.pstn_target || payload.pstnTarget || null,
    script_played_at: payload.script_played_at || new Date().toISOString(),
    transfer_attempted_at: payload.transfer_attempted_at || null,
    outcome: payload.outcome || 'pending',
    metadata_json: payload.metadata || payload.metadata_json || {}
  };
  try {
    db?.insertHandoffEscalation?.(row);
  } catch (e) {
    console.warn('[escalation] insertHandoffEscalation failed:', e.message);
  }
  try {
    db?.insertKellyCallEvent?.({
      session_id: row.session_id,
      call_id: row.call_id,
      event_type: payload.event_type || 'fail_closed_escalation',
      clinic_id: payload.clinic_id || null,
      customer_id: payload.customer_id || null,
      payload_json: {
        reason: row.reason,
        pstn_target: row.pstn_target,
        outcome: row.outcome,
        ...row.metadata_json
      }
    });
  } catch (_) {}
  return row;
}

/**
 * @returns {{ reply?: string, transfer_number?: string, outcome: string, pstn_target?: string }}
 */
function attemptEscalation(db, opts = {}) {
  const locale = String(opts.locale || 'en').slice(0, 2);
  const { number, source } = resolvePstnTarget(db, {
    clinicId: opts.clinicId || opts.clinic_id,
    customerId: opts.customerId || opts.customer_id
  });
  const pstn = normalizeE164(number);
  const reason = opts.reason || 'fail_closed_handoff';

  if (!pstn) {
    recordHandoffEscalation(db, {
      ...opts,
      reason,
      pstn_target: null,
      outcome: 'no_pstn_configured',
      metadata: { source }
    });
    const erCopy =
      locale === 'es'
        ? 'Si tiene una emergencia médica, cuelgue y llame al nueve uno uno de inmediato.'
        : locale === 'zh'
          ? '如有医疗紧急情况，请立即挂断并拨打911。'
          : 'If this is a medical emergency, please hang up and call 911 immediately.';
    return {
      reply: erCopy,
      outcome: 'no_pstn_configured',
      end_call: true
    };
  }

  const script = opts.reply || handoffCopy(locale);
  recordHandoffEscalation(db, {
    ...opts,
    reason,
    pstn_target: pstn,
    transfer_attempted_at: new Date().toISOString(),
    outcome: 'transfer_requested',
    metadata: { source }
  });

  return {
    reply: script,
    transfer_number: pstn,
    pstn_target: pstn,
    outcome: 'transfer_requested'
  };
}

/**
 * Patch the latest handoff_escalations row for a call/session.
 */
function updateHandoffOutcome(db, { sessionId, callId, outcome, error } = {}) {
  if (!db?.updateHandoffEscalationOutcome) return null;
  try {
    return db.updateHandoffEscalationOutcome({
      session_id: sessionId || callId,
      call_id: callId || sessionId,
      outcome: outcome || 'unknown',
      error: error || null
    });
  } catch (e) {
    console.warn('[escalation] updateHandoffOutcome failed:', e.message);
    return null;
  }
}

module.exports = {
  getOperatorFallbackPstn,
  resolvePstnTarget,
  recordHandoffEscalation,
  attemptEscalation,
  updateHandoffOutcome,
  normalizeE164
};
