'use strict';

const { ConversationMode } = require('./conversation-mode-types');
const { UserIntent } = require('./conversation-mode-types');

/**
 * V1–V14 acceptance scenarios for Jest.
 * Each entry: id, description, setup, utterance, expected assertions.
 */
const ACCEPTANCE_SCENARIOS = [
  {
    id: 'V1',
    name: 'somo_demo isolation',
    call_type: 'somo_demo',
    direction: 'inbound',
    mode: ConversationMode.PLATFORM_SUPPORT,
    forbidden_tools: ['store_triage_opqrst', 'schedule_appointment', 'request_patient_payment']
  },
  {
    id: 'V2',
    name: 'sales_outbound playbook only',
    call_type: 'sales_outbound',
    direction: 'outbound',
    mode: ConversationMode.OUTBOUND_SALES,
    forbidden_tools: ['store_triage_opqrst', 'schedule_appointment', 'request_patient_payment']
  },
  {
    id: 'V3',
    name: 'operator_outbound callback only',
    call_type: 'operator_outbound',
    direction: 'outbound',
    mode: ConversationMode.OPERATOR_OUTBOUND,
    forbidden_tools: ['store_triage_opqrst', 'schedule_appointment']
  },
  {
    id: 'V4',
    name: 'tenant admin book without OPQRST',
    call_type: 'inbound_tenant',
    direction: 'inbound',
    mode: ConversationMode.TENANT_INBOUND_ADMIN,
    utterance: 'I want to book an appointment',
    expected_subrail: 'booking',
    triage_policy: 'disabled'
  },
  {
    id: 'V5',
    name: 'tenant clinical rash OPQRST to booking',
    call_type: 'inbound_tenant',
    direction: 'inbound',
    mode: ConversationMode.TENANT_INBOUND_CLINICAL,
    utterance: 'I have a rash on my leg',
    expected_subrail: 'opqrst',
    triage_policy: 'required'
  },
  {
    id: 'V6',
    name: 'admin pay copay mid-call pivot',
    call_type: 'inbound_tenant',
    direction: 'inbound',
    start_mode: ConversationMode.TENANT_INBOUND_ADMIN,
    utterance: 'I want to pay my copay',
    expected_mode: ConversationMode.TENANT_BILLING,
    expected_subrail: 'copay_link',
    pivot_same_turn: true
  },
  {
    id: 'V7',
    name: 'multi-intent pay copay and reschedule',
    utterance: 'pay copay and reschedule',
    expected_mode: ConversationMode.TENANT_BILLING,
    expected_pending_intents: [UserIntent.RESCHEDULE]
  },
  {
    id: 'V8',
    name: 'cancellation subrail no re-triage',
    utterance: 'I need to cancel my appointment',
    expected_subrail: 'cancellation',
    no_opqrst_restart: true
  },
  {
    id: 'V9',
    name: 'reschedule after cancel chain',
    utterance: 'actually reschedule instead',
    from_subrail: 'cancellation',
    expected_subrail: 'booking'
  },
  {
    id: 'V10',
    name: 'OPQRST inconclusive no hang',
    triage_policy: 'required',
    opqrst_exit: 'inconclusive_triage',
    expected_disposition: 'triage_inconclusive'
  },
  {
    id: 'V11',
    name: 'OPQRST mid-flow billing pivot preserves accumulator',
    start_subrail: 'opqrst',
    utterance: 'pay my copay',
    expected_mode: ConversationMode.TENANT_BILLING,
    preserve_opqrst_accumulator: true
  },
  {
    id: 'V12',
    name: 'OPQRST emergency phrase',
    utterance: 'I have chest pain',
    expected_mode: ConversationMode.EMERGENCY_SAFETY,
    forbidden_tools: ['schedule_appointment', 'request_patient_payment']
  },
  {
    id: 'V13',
    name: 'records question no forced triage',
    utterance: 'what did my doctor say at my last visit',
    expected_mode: ConversationMode.TENANT_RECORDS,
    expected_subrail: 'records_qa'
  },
  {
    id: 'V14',
    name: 'missing call_type fail-closed',
    call_type: null,
    direction: 'inbound',
    tenant_resolved: true,
    expected_mode: ConversationMode.TENANT_INBOUND_ADMIN,
    fail_closed: true,
    no_clinical_default: true
  }
];

function getScenario(id) {
  return ACCEPTANCE_SCENARIOS.find((s) => s.id === id) || null;
}

module.exports = { ACCEPTANCE_SCENARIOS, getScenario };
