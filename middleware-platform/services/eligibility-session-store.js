'use strict';

const db = require('../database');
const healthSessionRouting = require('../database/repos/health-session-routing');

function _storeEligibilityOnSessionImpl({
  sessionId,
  appointmentId,
  patientId,
  insResult = {},
  finalResolution = {}
} = {}) {
  if (!sessionId) return null;
  const copayCents =
    finalResolution.amount != null
      ? Math.round(Number(finalResolution.amount) * 100)
      : insResult.copay_due_now != null
        ? Math.round(Number(insResult.copay_due_now) * 100)
        : null;
  const eligibilityId = insResult.eligibility_id || insResult.id || insResult.eligibility_event_id || null;
  const eligible = insResult.eligible;
  const status =
    finalResolution.status === 'hard_number'
      ? 'verified'
      : finalResolution.status === 'thin'
        ? 'thin'
        : eligible === false
          ? 'inactive'
          : 'pending';

  healthSessionRouting.upsertRow({
    sessionId,
    eligibilityStatus: status,
    eligible: eligible == null ? null : !!eligible,
    copayCents,
    payerId: insResult.payer_id || null,
    memberId: insResult.member_id || null,
    routingPayloadJson: JSON.stringify({
      patient_id: patientId,
      eligibility_id: eligibilityId,
      amount_resolution: finalResolution,
      eligibility_quality: insResult.eligibility_quality || null
    })
  });

  if (appointmentId && db.db) {
    try {
      db.db
        .prepare(
          `
          UPDATE appointments
          SET last_eligibility_id = COALESCE(?, last_eligibility_id),
              eligibility_status = ?,
              eligibility_copay_cents = COALESCE(?, eligibility_copay_cents),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
        )
        .run(eligibilityId, status, copayCents, appointmentId);
    } catch (_) {}
  }

  return { sessionId, eligibilityId, status, copayCents };
}

function storeEligibilityOnSession(args = {}) {
  const result = _storeEligibilityOnSessionImpl(args);
  try {
    const { onEligibilityComplete } = require('./internal-events');
    onEligibilityComplete({
      sessionId: args.sessionId,
      clinicId: args.clinicId,
      patientId: args.patientId,
      ...args.insResult,
      finalResolution: args.finalResolution
    });
  } catch (_) {}
  return result;
}

module.exports = { storeEligibilityOnSession };
