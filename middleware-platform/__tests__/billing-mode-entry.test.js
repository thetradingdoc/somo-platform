'use strict';

const { seedModeAtCallStart } = require('../services/conversation-mode/conversation-mode-session');

describe('billing mode entry at call start', () => {
  test('seedModeAtCallStart sets tenant_billing from copay first utterance', () => {
    const { fields } = seedModeAtCallStart({
      call_type: 'tenant',
      direction: 'inbound',
      firstUtterance: 'I need to pay my copay please send a payment link',
      tenantPolicy: { billing_enabled: true, records_enabled: true }
    });

    expect(fields.conversation_mode).toBe('tenant_billing');
    expect(fields.active_subrail).toBe('copay_link');
    expect(fields.pivot_reason).toBe('intent_billing_at_start');
  });
});
