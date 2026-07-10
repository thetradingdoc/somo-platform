'use strict';

const { ConversationMode, Subrail } = require('./conversation-mode-types');
const { isOpqrstFieldGateEnabled } = require('../kelly-rails/config');
const { TriagePolicy } = require('./tenant-policy');

/**
 * Mode + subrail tool firewall.
 * Blocks cross-mode tool bleed per plan P5.
 */

const ALWAYS_ALLOWED = new Set(['get_triage_session', 'end_call']);

const CLINICAL_TOOLS = new Set([
  'store_triage_opqrst',
  'store_triage_rich_intake',
  'run_triage_rag'
]);

const CODING_SEARCH_TOOLS = new Set([
  'search_icd10_codes',
  'search_cpt_codes',
  'search_hcpcs_codes',
  'search_cdt_codes',
  'suggest_codes_from_symptoms',
  'validate_code_pair',
  'collect_insurance'
]);

const MODE_FORBIDDEN_TOOLS = {
  [ConversationMode.DEMO_QUAL]: new Set([
    'store_triage_opqrst',
    'schedule_appointment',
    'request_patient_payment',
    'run_triage_rag',
    'cancel_appointment',
    'reschedule_appointment',
    ...CODING_SEARCH_TOOLS
  ]),
  [ConversationMode.OUTBOUND_SALES]: new Set([
    'store_triage_opqrst',
    'schedule_appointment',
    'request_patient_payment',
    'run_triage_rag',
    'cancel_appointment',
    ...CODING_SEARCH_TOOLS
  ]),
  [ConversationMode.OPERATOR_OUTBOUND]: new Set([
    'store_triage_opqrst',
    'schedule_appointment',
    'run_triage_rag',
    'request_patient_payment'
  ]),
  [ConversationMode.PLATFORM_SUPPORT]: new Set([
    'store_triage_opqrst',
    'store_triage_rich_intake',
    'run_triage_rag',
    'schedule_appointment',
    'request_patient_payment',
    'cancel_appointment',
    'reschedule_appointment',
    'create_appointment_checkout',
    'search_appointments',
    'query_patient_records',
    'collect_insurance',
    'compute_visit_quote'
  ]),
  [ConversationMode.EMERGENCY_SAFETY]: new Set([
    'schedule_appointment',
    'request_patient_payment',
    'store_triage_opqrst'
  ]),
  [ConversationMode.NAVIGATION_MEMBER]: new Set([
    'store_triage_opqrst',
    'run_triage_rag',
    'store_triage_rich_intake'
  ]),
  [ConversationMode.TENANT_RECORDS]: new Set(['schedule_appointment', 'request_patient_payment'])
};

const SUBRAIL_FORBIDDEN_TOOLS = {
  [Subrail.OPQRST]: new Set(['schedule_appointment', 'request_patient_payment']),
  [Subrail.COPAY_LINK]: new Set(['store_triage_opqrst', 'schedule_appointment']),
  [Subrail.RECORDS_QA]: new Set(['schedule_appointment', 'request_patient_payment']),
  [Subrail.BOOKING]: new Set(['store_triage_opqrst']),
  [Subrail.CANCELLATION]: new Set(['store_triage_opqrst', 'request_patient_payment']),
  [Subrail.HANDOFF]: new Set([
    'store_triage_opqrst',
    'store_triage_rich_intake',
    'run_triage_rag',
    'schedule_appointment'
  ])
};

const SITE_SENSITIVE_TOOLS = new Set([
  'store_triage_opqrst',
  'store_triage_rich_intake',
  'run_triage_rag',
  'schedule_appointment',
  'cancel_appointment',
  'reschedule_appointment',
  'create_appointment_checkout',
  'search_appointments',
  'transfer_call'
]);

function isSiteSensitiveToolBlocked(ctx = {}, name) {
  if (!SITE_SENSITIVE_TOOLS.has(name)) return false;
  const status = ctx.site_context_status || ctx.siteContextStatus;
  if (!status || status === 'not_required' || status === 'verified') return false;
  return true;
}

/** Tools outside KELLY_TOOLS but valid in specific modes (sales, navigation, Retell). */
const EXTRA_REGISTERED_TOOL_NAMES = new Set([
  'collect_contact_info',
  'schedule_demo',
  'request_human_handoff',
  'transfer_call',
  'resolve_patient_plan',
  'check_plan_benefits',
  'find_care_near_me',
  'resolve_employer_member',
  'patient_intake',
  'get_patient_intake_status',
  'confirm_appointment',
  'verify_checkout_code',
  'get_patient_claims',
  'send_followup_email',
  'send_followup_sms',
  'search_products',
  'create_checkout',
  'get_available_payment_methods',
  'get_order_tracking',
  'verify_email_code',
  'verify_email_verification_code'
]);

let _registeredKellyToolNames = null;

function getRegisteredToolNames() {
  if (_registeredKellyToolNames) return _registeredKellyToolNames;
  const names = new Set(EXTRA_REGISTERED_TOOL_NAMES);
  for (const n of ALWAYS_ALLOWED) names.add(n);
  try {
    const { KELLY_TOOLS } = require('../kelly-agent-service');
    for (const t of KELLY_TOOLS || []) {
      const n = t?.function?.name;
      if (n) names.add(n);
    }
  } catch (_) {}
  _registeredKellyToolNames = names;
  return names;
}

function isRegisteredToolName(name) {
  return getRegisteredToolNames().has(String(name || '').trim());
}

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

function isClinicalToolBlocked(ctx = {}, name) {
  if (!CLINICAL_TOOLS.has(name)) return false;
  if (ctx.fail_closed || ctx.routing_world === 'unidentified') return true;
  const triagePolicy = String(ctx.triage_policy || ctx.triagePolicy || '').toLowerCase();
  if (triagePolicy === TriagePolicy.DISABLED) return true;
  if (ctx.routing_world === 'platform_support') return true;
  if (ctx.active_subrail === Subrail.HANDOFF || ctx.subrail === Subrail.HANDOFF) return true;
  if (
    ctx.conversation_mode === ConversationMode.TENANT_INBOUND_ADMIN &&
    ctx.active_subrail !== Subrail.OPQRST &&
    ctx.subrail !== Subrail.OPQRST
  ) {
    return true;
  }
  return false;
}

function isToolAllowedForMode(toolName, ctx = {}) {
  const name = String(toolName || '').trim();
  if (!name) return false;
  if (ALWAYS_ALLOWED.has(name)) return true;

  if (name === 'check_plan_benefits') {
    const triagePolicy = String(ctx.triage_policy || ctx.triagePolicy || '').toLowerCase();
    const useCase = String(ctx.use_case || ctx.prompt_use_case || '').toLowerCase();
    if (triagePolicy === TriagePolicy.DISABLED || useCase === 'dental') return false;
  }

  if (isSiteSensitiveToolBlocked(ctx, name)) return false;
  if (isClinicalToolBlocked(ctx, name)) return false;

  const mode = ctx.conversation_mode || ctx.mode;
  const subrail = ctx.active_subrail || ctx.subrail;

  if (mode === ConversationMode.NAVIGATION_MEMBER) {
    const allowed = new Set([
      'resolve_patient_plan',
      'check_plan_benefits',
      'find_care_near_me',
      'resolve_employer_member',
      'get_available_slots',
      'schedule_appointment',
      'collect_insurance',
      'create_appointment_checkout',
      'end_call',
      'get_triage_session'
    ]);
    return allowed.has(name);
  }

  if (
    mode === ConversationMode.PLATFORM_SUPPORT ||
    mode === ConversationMode.OUTBOUND_SALES ||
    mode === ConversationMode.DEMO_QUAL
  ) {
    const salesAllowed = new Set([
      'collect_contact_info',
      'schedule_demo',
      'end_call',
      'transfer_call',
      'get_triage_session',
      'request_human_handoff'
    ]);
    if (salesAllowed.has(name)) return true;
  }

  const modeForbidden = MODE_FORBIDDEN_TOOLS[mode];
  if (modeForbidden?.has(name)) return false;

  if (name === 'store_triage_opqrst') {
    if (
      isOpqrstFieldGateEnabled() &&
      (ctx.allowStoreOpqrst || ctx._opqrst_gate?.allowStoreOpqrst)
    ) {
      return true;
    }
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
    try {
      const triagePolicy = String(ctx.triage_policy || ctx.triagePolicy || '').toLowerCase();
      if (triagePolicy === TriagePolicy.DISABLED && ctx.sessionId) {
        const { frontDeskIntakeComplete } = require('../front-desk-intake');
        if (!frontDeskIntakeComplete(ctx.sessionId)) return false;
      }
    } catch (_) {}
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

  return isRegisteredToolName(name);
}

function buildFirewallContext(context = {}, toolName = '') {
  return {
    conversation_mode: context.conversation_mode || context.mode,
    active_subrail: context.active_subrail || context.subrail,
    site_context_status: context.site_context_status || context.siteContextStatus || null,
    routing_world: context.routing_world || null,
    triage_policy: context.triage_policy || context.triagePolicy || null,
    use_case: context.use_case || context.prompt_use_case || null,
    clinicId: context.clinicId || null,
    customerId: context.customerId || null,
    sessionId: context.sessionId || context.session_id || null,
    callId: context.callId || context.call_id || null,
    step: context.step || null,
    allowStoreOpqrst: context.allowStoreOpqrst,
    _opqrst_gate: context._opqrst_gate,
    fail_closed: context.fail_closed,
    toolName: toolName || context.toolName || null
  };
}

function logModeViolation(db, ctx = {}) {
  try {
    db?.insertKellyCallEvent?.({
      session_id: ctx.sessionId || ctx.session_id || null,
      call_id: ctx.callId || ctx.call_id || null,
      event_type: 'mode_violation_blocked',
      payload_json: {
        tool: ctx.toolName,
        routing_world: ctx.routing_world || null,
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
  EXTRA_REGISTERED_TOOL_NAMES,
  isToolAllowedForMode,
  isRegisteredToolName,
  getRegisteredToolNames,
  buildFirewallContext,
  logModeViolation,
  isClinicalToolBlocked
};
