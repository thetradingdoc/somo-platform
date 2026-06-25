'use strict';

/** Top-level conversation modes (8). */
const ConversationMode = Object.freeze({
  DEMO_QUAL: 'demo_qual',
  NAVIGATION_MEMBER: 'navigation_member',
  OUTBOUND_SALES: 'outbound_sales',
  OPERATOR_OUTBOUND: 'operator_outbound',
  TENANT_INBOUND_ADMIN: 'tenant_inbound_admin',
  TENANT_INBOUND_CLINICAL: 'tenant_inbound_clinical',
  TENANT_BILLING: 'tenant_billing',
  TENANT_RECORDS: 'tenant_records',
  EMERGENCY_SAFETY: 'emergency_safety'
});

/** Within-rail subrails. */
const Subrail = Object.freeze({
  BOOKING: 'booking',
  CANCELLATION: 'cancellation',
  OPQRST: 'opqrst',
  COPAY_LINK: 'copay_link',
  RECORDS_QA: 'records_qa',
  HANDOFF: 'handoff'
});

/** Billing copay subrail steps. */
const BillingStep = Object.freeze({
  IDENTIFY_ACCOUNT: 'identify_account',
  AMOUNT_CONFIRM: 'amount_confirm',
  LINK_SENT: 'link_sent',
  RECEIPT_CONFIRM: 'receipt_confirm'
});

/** Detected user intents for pivot + queue. */
const UserIntent = Object.freeze({
  BOOK: 'book',
  CANCEL: 'cancel',
  RESCHEDULE: 'reschedule',
  PAY_COPAY: 'pay_copay',
  BILLING_FAQ: 'billing_faq',
  SYMPTOM: 'symptom',
  RECORDS: 'records',
  EMERGENCY: 'emergency',
  HANDOFF: 'handoff',
  APPT_LOOKUP: 'appt_lookup',
  GENERAL: 'general'
});

const ALL_CONVERSATION_MODES = Object.values(ConversationMode);
const ALL_SUBRAILS = Object.values(Subrail);

function isConversationMode(v) {
  return ALL_CONVERSATION_MODES.includes(v);
}

function isSubrail(v) {
  return ALL_SUBRAILS.includes(v);
}

/** Map legacy call_type metadata to resolver inputs. */
function normalizeCallType(callType) {
  const t = String(callType || '').toLowerCase().trim();
  if (t === 'somo_demo') return 'somo_demo';
  if (t === 'sales_outbound') return 'sales_outbound';
  if (t === 'operator_outbound') return 'operator_outbound';
  if (t === 'inbound_tenant' || t === 'inbound') return 'inbound_tenant';
  if (t === 'consumer_navigation') return 'consumer_navigation';
  if (t === 'sequence_automation') return 'operator_outbound';
  return t || 'unknown';
}

function normalizeDirection(direction, callType) {
  const d = String(direction || '').toLowerCase().trim();
  if (d === 'inbound' || d === 'outbound') return d;
  if (callType === 'sales_outbound' || callType === 'operator_outbound') return 'outbound';
  if (callType === 'somo_demo') return 'inbound';
  return 'inbound';
}

module.exports = {
  ConversationMode,
  Subrail,
  BillingStep,
  UserIntent,
  ALL_CONVERSATION_MODES,
  ALL_SUBRAILS,
  isConversationMode,
  isSubrail,
  normalizeCallType,
  normalizeDirection
};
