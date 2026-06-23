'use strict';

/** Call / rail exit dispositions. */
const Disposition = Object.freeze({
  COMPLETED: 'completed',
  CTA_SENT: 'cta_sent',
  EMERGENCY_REDIRECT: 'emergency_redirect',
  BLOCKED: 'blocked',
  TRIAGE_PENDING: 'triage_pending',
  TRIAGE_INCONCLUSIVE: 'triage_inconclusive',
  BOOKING_CONFLICT: 'booking_conflict',
  PAYMENT_FAILED: 'payment_failed',
  RECORDS_REQUESTED: 'records_requested',
  HANDOFF_REQUESTED: 'handoff_requested',
  HANDOFF_FAILED: 'handoff_failed',
  PAID: 'paid',
  ESCALATED: 'escalated',
  HANDOFF: 'handoff'
});

const ALL_DISPOSITIONS = Object.values(Disposition);

function isDisposition(v) {
  return ALL_DISPOSITIONS.includes(v);
}

/** Map session flags to disposition on call end. */
function resolveDispositionFromState(state = {}) {
  const flags = state.flags || {};
  const mode = state.conversation_mode;
  const subrail = state.active_subrail;

  if (flags.safety_blocked || mode === 'emergency_safety') {
    return Disposition.EMERGENCY_REDIRECT;
  }
  if (flags.pending_human_handoff) {
    return flags.handoff_failed ? Disposition.HANDOFF_FAILED : Disposition.HANDOFF_REQUESTED;
  }
  if (flags.payment_failed) return Disposition.PAYMENT_FAILED;
  if (flags.payment_complete) return Disposition.PAID;
  if (flags.booking_conflict) return Disposition.BOOKING_CONFLICT;
  if (flags.triage_inconclusive) return Disposition.TRIAGE_INCONCLUSIVE;
  if (subrail === 'records_qa' && flags.records_deferred) return Disposition.RECORDS_REQUESTED;
  if (flags.blocked) return Disposition.BLOCKED;
  return Disposition.COMPLETED;
}

module.exports = {
  Disposition,
  ALL_DISPOSITIONS,
  isDisposition,
  resolveDispositionFromState
};
