'use strict';

const { ConversationMode, Subrail, UserIntent, normalizeCallType, normalizeDirection } = require('./conversation-mode-types');
const { primaryIntent, isEmergency } = require('./intent-detector');
const { TriagePolicy, canPivotToClinical, bookingAllowedWithoutOpqrst } = require('./tenant-policy');

/**
 * Resolve conversation mode at call start.
 * @param {object} input
 * @param {string} input.call_type
 * @param {string} input.direction
 * @param {object} input.tenantPolicy
 * @param {string} [input.firstUtterance]
 * @param {boolean} [input.tenantResolved]
 */
function resolveConversationMode(input = {}) {
  const callType = normalizeCallType(input.call_type);
  const direction = normalizeDirection(input.direction, callType);
  const policy = input.tenantPolicy || {};
  const utterance = input.firstUtterance || '';
  const tenantResolved = input.tenantResolved !== false;

  if (isEmergency(utterance)) {
    return {
      mode: ConversationMode.EMERGENCY_SAFETY,
      subrail: Subrail.HANDOFF,
      reason: 'emergency_at_start',
      call_type: callType,
      direction
    };
  }

  if (callType === 'somo_demo') {
    return { mode: ConversationMode.DEMO_QUAL, subrail: null, reason: 'call_type_demo', call_type: callType, direction };
  }
  if (callType === 'sales_outbound') {
    return { mode: ConversationMode.OUTBOUND_SALES, subrail: null, reason: 'call_type_sales', call_type: callType, direction };
  }
  if (callType === 'operator_outbound') {
    return { mode: ConversationMode.OPERATOR_OUTBOUND, subrail: null, reason: 'call_type_operator', call_type: callType, direction };
  }

  if (!tenantResolved) {
    return {
      mode: ConversationMode.TENANT_INBOUND_ADMIN,
      subrail: Subrail.HANDOFF,
      reason: 'tenant_unresolved_fail_closed',
      call_type: callType,
      direction,
      fail_closed: true
    };
  }

  const intent = primaryIntent(utterance);
  const pi = intent.intent;

  if (pi === UserIntent.PAY_COPAY && policy.billing_enabled !== false) {
    return {
      mode: ConversationMode.TENANT_BILLING,
      subrail: Subrail.COPAY_LINK,
      reason: 'intent_billing',
      call_type: callType,
      direction
    };
  }

  if (pi === UserIntent.RECORDS && policy.records_enabled !== false) {
    return {
      mode: ConversationMode.TENANT_RECORDS,
      subrail: Subrail.RECORDS_QA,
      reason: 'intent_records',
      call_type: callType,
      direction
    };
  }

  if (pi === UserIntent.CANCEL) {
    return {
      mode: ConversationMode.TENANT_INBOUND_ADMIN,
      subrail: Subrail.CANCELLATION,
      reason: 'intent_cancel',
      call_type: callType,
      direction
    };
  }

  if (pi === UserIntent.APPT_LOOKUP) {
    return {
      mode: ConversationMode.TENANT_INBOUND_ADMIN,
      subrail: Subrail.CANCELLATION,
      reason: 'intent_appt_lookup',
      call_type: callType,
      direction
    };
  }

  if (pi === UserIntent.RESCHEDULE) {
    return {
      mode: ConversationMode.TENANT_INBOUND_ADMIN,
      subrail: Subrail.CANCELLATION,
      reason: 'intent_reschedule',
      call_type: callType,
      direction
    };
  }

  if (pi === UserIntent.SYMPTOM && canPivotToClinical(policy)) {
    return {
      mode: ConversationMode.TENANT_INBOUND_CLINICAL,
      subrail: Subrail.OPQRST,
      reason: 'intent_symptom',
      call_type: callType,
      direction
    };
  }

  if (pi === UserIntent.BOOK) {
    const adminMode = ConversationMode.TENANT_INBOUND_ADMIN;
    if (bookingAllowedWithoutOpqrst(policy, adminMode) || policy.triage_policy === TriagePolicy.DISABLED) {
      return {
        mode: adminMode,
        subrail: Subrail.BOOKING,
        reason: 'intent_book_admin',
        call_type: callType,
        direction
      };
    }
    if (policy.triage_policy === TriagePolicy.REQUIRED) {
      return {
        mode: ConversationMode.TENANT_INBOUND_CLINICAL,
        subrail: Subrail.OPQRST,
        reason: 'intent_book_requires_triage',
        call_type: callType,
        direction
      };
    }
    return {
      mode: adminMode,
      subrail: Subrail.BOOKING,
      reason: 'intent_book_conditional',
      call_type: callType,
      direction
    };
  }

  return {
    mode: ConversationMode.TENANT_INBOUND_ADMIN,
    subrail: null,
    reason: 'default_admin',
    call_type: callType,
    direction
  };
}

module.exports = { resolveConversationMode };
