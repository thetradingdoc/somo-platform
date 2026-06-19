'use strict';

const { primaryIntent } = require('../services/conversation-mode/intent-detector');
const { UserIntent } = require('../services/conversation-mode/conversation-mode-types');
const { resolveConversationMode } = require('../services/conversation-mode/conversation-mode-resolver');
const { isToolAllowedForMode } = require('../services/conversation-mode/mode-tool-firewall');

describe('platform voice tenant hardening (T-1, T-2, T-3)', () => {
  test('T-2: tenant book without symptoms → admin booking at seed', () => {
    const mode = resolveConversationMode({
      call_type: 'inbound_tenant',
      direction: 'inbound',
      tenantResolved: true,
      firstUtterance: 'Can I make a booking?',
      tenantPolicy: { triage_policy: 'conditional' }
    });
    expect(mode.mode).toBe('tenant_inbound_admin');
    expect(mode.subrail).toBe('booking');
    expect(mode.mode).not.toBe('tenant_inbound_clinical');
  });

  test('T-3: clinical seed only with symptom evidence (conditional); required triage on book → OPQRST', () => {
    const bookConditional = resolveConversationMode({
      call_type: 'inbound_tenant',
      direction: 'inbound',
      tenantResolved: true,
      firstUtterance: 'Can I make a booking?',
      tenantPolicy: { triage_policy: 'conditional' }
    });
    expect(bookConditional.subrail).toBe('booking');

    const bookRequired = resolveConversationMode({
      call_type: 'inbound_tenant',
      direction: 'inbound',
      tenantResolved: true,
      firstUtterance: 'Can I make a booking?',
      tenantPolicy: { triage_policy: 'required' }
    });
    expect(bookRequired.mode).toBe('tenant_inbound_clinical');
    expect(bookRequired.subrail).toBe('opqrst');

    const withSymptom = resolveConversationMode({
      call_type: 'inbound_tenant',
      direction: 'inbound',
      tenantResolved: true,
      firstUtterance: 'I have a rash on my leg',
      tenantPolicy: { triage_policy: 'conditional' }
    });
    expect(withSymptom.mode).toBe('tenant_inbound_clinical');
  });

  test('T-1 / CR-052+: handoff subrail blocks OPQRST tools', () => {
    expect(
      isToolAllowedForMode('store_triage_opqrst', {
        conversation_mode: 'tenant_inbound_admin',
        active_subrail: 'handoff',
        routing_world: 'unidentified',
        fail_closed: true
      })
    ).toBe(false);
  });
});

describe('mode-tool-firewall CR-026+', () => {
  test('triage_policy disabled blocks clinical tools', () => {
    expect(
      isToolAllowedForMode('store_triage_opqrst', {
        conversation_mode: 'tenant_inbound_admin',
        active_subrail: 'booking',
        triage_policy: 'disabled'
      })
    ).toBe(false);
  });

  test('SITE-05: site_context_status missing blocks booking tools', () => {
    expect(
      isToolAllowedForMode('schedule_appointment', {
        conversation_mode: 'tenant_inbound_admin',
        active_subrail: 'booking',
        site_context_status: 'missing'
      })
    ).toBe(false);
    expect(
      isToolAllowedForMode('schedule_appointment', {
        conversation_mode: 'tenant_inbound_admin',
        active_subrail: 'booking',
        site_context_status: 'verified'
      })
    ).toBe(true);
  });
});
