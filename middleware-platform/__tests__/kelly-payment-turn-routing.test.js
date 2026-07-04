'use strict';

const meta = {};

jest.mock('../services/kelly-rails/gates/shared', () => {
  const KellyToolExecutor = {
    execute: jest.fn(async () => ({ success: true })),
    _getSessionMeta: jest.fn((sid, key) => meta[`${sid}:${key}`] || null),
    _setSessionMeta: jest.fn((sid, key, val) => {
      meta[`${sid}:${key}`] = val;
    })
  };
  return {
    KellyToolExecutor,
    executeDeterministicTool: jest.fn(async () => ({
      success: true,
      pay_token: 'tok_test_123',
      pay_url: 'https://pay.test/link'
    }))
  };
});

const { runDeterministicPayment } = require('../services/kelly-rails/gates/payment');
const { KELLY_LANE } = require('../services/kelly-rails/state-schema');

describe('payment turn routing stability', () => {
  const sessionId = 'pay-route-stability';

  beforeEach(() => {
    Object.keys(meta).forEach((k) => delete meta[k]);
    meta[`${sessionId}:quote_delivered`] = '1';
    meta[`${sessionId}:copay_amount`] = '25';
    meta[`${sessionId}:last_quote_status`] = 'hard_number';
  });

  test('payment gate wins 10/10 on pay-link utterance', async () => {
    const utterance = 'Yes, send me the payment link by text.';
    for (let i = 0; i < 10; i++) {
      const state = {
        active_lane: KELLY_LANE.PAYMENT,
        step: 'pay_invoice',
        flags: {
          copay_amount: 25,
          quote_delivered: '1',
          last_quote_status: 'hard_number'
        }
      };
      const ctx = {
        sessionId,
        clinicId: 'c1',
        patientId: 'p1',
        callerPhone: '+15551234567',
        channel: 'voice',
        message: utterance
      };
      const out = await runDeterministicPayment(state, ctx);
      expect(out).not.toBeNull();
      expect(out.toolsUsed).toContain('request_patient_payment');
      expect(out.toolsUsed).not.toContain('get_triage_session');
    }
  });
});
