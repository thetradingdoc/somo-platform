'use strict';

const { ConversationMode, Subrail } = require('./conversation-mode-types');

/**
 * Mode + subrail tool firewall.
 * Blocks cross-mode tool bleed per plan P5.
 */

const ALWAYS_ALLOWED = new Set(['get_triage_session', 'end_call', 'transfer_call']);

const MODE_FORBIDDEN_TOOLS = {
  [ConversationMode.DEMO_QUAL]: new Set([
    'store_triage_opqrst',
    'schedule_appointment',
    'request_patient_payment',
    'run_triage_rag',
    'cancel_appointment',
    'reschedule_appointment'
  ]),
  [ConversationMode.OUTBOUND_SALES]: new Set([
    'store_triage_opqrst',
    'schedule_appointment',
    'request_patient_payment',
    'run_triage_rag',
    'cancel_appointment'
  ]),
  [ConversationMode.OPERATOR_OUTBOUND]: new Set([
    'store_triage_opqrst',
    'schedule_appointment',
    'run_triage_rag',
    'request_patient_payment'
  ]),
  [ConversationMode.EMERGENCY_SAFETY]: new Set([
    'schedule_appointment',
    'request_patient_payment',
    'store_triage_opqrst'
  ]),
  [ConversationMode.TENANT_RECORDS]: new Set(['schedule_appointment', 'request_patient_payment'])
};

const SUBRAIL_FORBIDDEN_TOOLS = {
  [Subrail.OPQRST]: new Set(['schedule_appointment', 'request_patient_payment']),
  [Subrail.COPAY_LINK]: new Set(['store_triage_opqrst', 'schedule_appointment']),
  [Subrail.RECORDS_QA]: new Set(['schedule_appointment', 'request_patient_payment']),
  [Subrail.BOOKING]: new Set(['store_triage_opqrst']),
  [Subrail.CANCELLATION]: new Set(['store_triage_opqrst', 'request_patient_payment'])
};

const SUBRAIL_ALLOWED_EXTRA = {
  [Subrail.OPQRST]: new Set(['store_triage_opqrst', 'store_triage_rich_intake', 'run_triage_rag']),
  [Subrail.COPAY_LINK]: new Set(['request_patient_payment', 'get_patient_claims', 'collect_insurance']),
  [Subrail.BOOKING]: new Set([
    'get_available_slots',
    'schedule_appointment',
    'create_appointment_checkout',
    'search_appointments'
  ]),
  [Subrail.CANCELLATION]: new Set(['search_appointments', 'cancel_appointment', 'reschedule_appointment']),
  [Subrail.RECORDS_QA]: new Set(['query_patient_records'])
};

function isToolAllowedForMode(toolName, ctx = {}) {
  const name = String(toolName || '').trim();
  if (!name) return false;
  if (ALWAYS_ALLOWED.has(name)) return true;

  const mode = ctx.conversation_mode || ctx.mode;
  const subrail = ctx.active_subrail || ctx.subrail;

  const modeForbidden = MODE_FORBIDDEN_TOOLS[mode];
  if (modeForbidden?.has(name)) return false;

  if (name === 'store_triage_opqrst') {
    return (
      mode === ConversationMode.TENANT_INBOUND_CLINICAL && subrail === Subrail.OPQRST
    );
  }

  if (name === 'request_patient_payment') {
    return (
      mode === ConversationMode.TENANT_BILLING ||
      (subrail === Subrail.COPAY_LINK && mode !== ConversationMode.EMERGENCY_SAFETY)
    );
  }

  if (name === 'schedule_appointment') {
    if (
      mode === ConversationMode.DEMO_QUAL ||
      mode === ConversationMode.OUTBOUND_SALES ||
      mode === ConversationMode.OPERATOR_OUTBOUND ||
      mode === ConversationMode.EMERGENCY_SAFETY
    ) {
      return false;
    }
    if (subrail === Subrail.BOOKING) return true;
    if (mode === ConversationMode.TENANT_INBOUND_ADMIN && !subrail) return true;
    if (
      mode === ConversationMode.TENANT_INBOUND_CLINICAL &&
      subrail !== Subrail.OPQRST
    ) {
      return true;
    }
    return false;
  }

  if (subrail) {
    const subForbidden = SUBRAIL_FORBIDDEN_TOOLS[subrail];
    if (subForbidden?.has(name)) return false;
  }

  return true;
}

function logModeViolation(db, ctx = {}) {
  try {
    db?.insertKellyCallEvent?.({
      session_id: ctx.sessionId || ctx.session_id || null,
      call_id: ctx.callId || ctx.call_id || null,
      event_type: 'mode_violation_blocked',
      payload_json: {
        tool: ctx.toolName,
        conversation_mode: ctx.conversation_mode || ctx.mode,
        active_subrail: ctx.active_subrail || ctx.subrail,
        step: ctx.step || null
      }
    });
  } catch (_) {}
}

module.exports = {
  ALWAYS_ALLOWED,
  MODE_FORBIDDEN_TOOLS,
  SUBRAIL_FORBIDDEN_TOOLS,
  SUBRAIL_ALLOWED_EXTRA,
  isToolAllowedForMode,
  logModeViolation
};
