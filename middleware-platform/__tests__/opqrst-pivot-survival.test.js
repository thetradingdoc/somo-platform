'use strict';

const { applyPivotToSession } = require('../services/conversation-mode/pivot-engine');
const { PivotEvent } = require('../services/conversation-mode/pivot-events');

describe('OPQRST pivot survival (T-3)', () => {
  test('billing pivot preserves opqrst_resume_field from gate openField', () => {
    const session = {
      conversation_mode: 'tenant_inbound_clinical',
      active_subrail: 'opqrst',
      flags: { _opqrst_gate: { openField: 'provocation' } }
    };
    const next = applyPivotToSession(session, {
      mode: 'tenant_billing',
      subrail: 'copay_link',
      prior_mode: 'tenant_inbound_clinical',
      pivot_event: PivotEvent.BILLING_INTENT_DETECTED,
      pivot_reason: 'billing_pivot',
      pending_intents: []
    });
    expect(next.opqrst_resume_field).toBe('provocation');
  });

  test('billing pivot keeps explicit resume field over gate', () => {
    const session = {
      conversation_mode: 'tenant_inbound_clinical',
      active_subrail: 'opqrst',
      opqrst_resume_field: 'quality'
    };
    const next = applyPivotToSession(session, {
      mode: 'tenant_billing',
      subrail: 'copay_link',
      prior_mode: 'tenant_inbound_clinical',
      pivot_event: PivotEvent.BILLING_INTENT_DETECTED,
      pivot_reason: 'billing_pivot',
      pending_intents: []
    });
    expect(next.opqrst_resume_field).toBe('quality');
  });
});
