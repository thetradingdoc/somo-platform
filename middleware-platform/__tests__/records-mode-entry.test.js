'use strict';

const { seedModeAtCallStart } = require('../services/conversation-mode/conversation-mode-session');
const { STAGED_ENFORCE_MODE_DEFAULTS } = require('../services/conversation-mode/config');

describe('records mode entry', () => {
  test('staged enforce defaults include tenant_records', () => {
    expect(STAGED_ENFORCE_MODE_DEFAULTS.tenant_records).toBe(true);
  });

  test('seedModeAtCallStart sets tenant_records from first utterance', () => {
    const { fields } = seedModeAtCallStart({
      call_type: 'tenant',
      direction: 'inbound',
      firstUtterance: 'Can I get a copy of my medical records?',
      tenantPolicy: { records_enabled: true, billing_enabled: true }
    });

    expect(fields.conversation_mode).toBe('tenant_records');
    expect(fields.active_subrail).toBe('records_qa');
    expect(fields.active_subrail_step).toBe('records_qa');
    expect(fields.pivot_reason).toBe('intent_records_at_start');
  });

  test('seedModeAtCallStart respects records_enabled policy', () => {
    const { fields } = seedModeAtCallStart({
      call_type: 'tenant',
      direction: 'inbound',
      firstUtterance: 'I need my health records',
      tenantPolicy: { records_enabled: false }
    });

    expect(fields.conversation_mode).not.toBe('tenant_records');
  });
});
