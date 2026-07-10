'use strict';

const { ConversationMode } = require('../services/conversation-mode/conversation-mode-types');
const { evaluateTurn } = require('../services/conversation-mode/pivot-engine');
const { isToolAllowedForMode } = require('../services/conversation-mode/mode-tool-firewall');

const PLATFORM_UTTERANCES = [
  'I want to book an appointment for tomorrow',
  'Can I reschedule my visit?',
  'I need to pay my copay',
  'What did my doctor say at my last visit',
  'I want to sign up for Somo for my dental office'
];

describe('platform_support pivot + tool firewall', () => {
  test.each(PLATFORM_UTTERANCES)('stays platform_support for: %s', (utterance) => {
    const result = evaluateTurn({
      mode: ConversationMode.PLATFORM_SUPPORT,
      utterance,
      tenantPolicy: { billing_enabled: true, records_enabled: true, triage_policy: 'required' },
      sessionState: { conversation_mode: ConversationMode.PLATFORM_SUPPORT }
    });
    expect(result.mode).toBe(ConversationMode.PLATFORM_SUPPORT);
    expect(result.mode).not.toBe(ConversationMode.TENANT_BILLING);
    expect(result.mode).not.toBe(ConversationMode.TENANT_INBOUND_CLINICAL);
    expect(result.mode).not.toBe(ConversationMode.TENANT_INBOUND_ADMIN);
  });

  test('chest pain escalates to emergency even on platform line', () => {
    const result = evaluateTurn({
      mode: ConversationMode.PLATFORM_SUPPORT,
      utterance: 'I have chest pain and a rash on my arm',
      tenantPolicy: { billing_enabled: true, records_enabled: true, triage_policy: 'required' },
      sessionState: { conversation_mode: ConversationMode.PLATFORM_SUPPORT }
    });
    expect(result.mode).toBe(ConversationMode.EMERGENCY_SAFETY);
  });

  test('clinical and booking tools blocked on platform_support', () => {
    const ctx = { conversation_mode: ConversationMode.PLATFORM_SUPPORT, routing_world: 'platform_support' };
    expect(isToolAllowedForMode('schedule_appointment', ctx)).toBe(false);
    expect(isToolAllowedForMode('store_triage_opqrst', ctx)).toBe(false);
    expect(isToolAllowedForMode('request_patient_payment', ctx)).toBe(false);
    expect(isToolAllowedForMode('query_patient_records', ctx)).toBe(false);
  });

  test('sales CRM tools allowed on platform_support', () => {
    const ctx = { conversation_mode: ConversationMode.PLATFORM_SUPPORT, routing_world: 'platform_support' };
    expect(isToolAllowedForMode('collect_contact_info', ctx)).toBe(true);
    expect(isToolAllowedForMode('schedule_demo', ctx)).toBe(true);
    expect(isToolAllowedForMode('end_call', ctx)).toBe(true);
  });
});
