'use strict';

jest.mock('../database', () => ({
  getTriageSession: jest.fn(() => null),
  db: null
}));

jest.mock('../services/kelly-tool-executor', () => ({
  execute: jest.fn(async () => ({
    success: true,
    pay_url: 'https://pay.example/link',
    pay_token: 'tok-fresh'
  })),
  _getSessionMeta: jest.fn(),
  _setSessionMeta: jest.fn()
}));

const { runDeterministicPayment } = require('../services/kelly-rails/lanes');
const { KELLY_LANE } = require('../services/kelly-rails/state-schema');

describe('kelly-rails runDeterministicPayment', () => {
  test('pay-now utterance uses request_patient_payment', async () => {
    const state = {
      active_lane: KELLY_LANE.PAYMENT,
      step: 'pay_invoice',
      flags: { copay_amount: 25, appointment_id: 'appt-1' }
    };
    const ctx = {
      sessionId: 'sess-pay',
      message: 'I need to pay my copay now please send a secure payment link',
      clinicId: 'c1',
      patientId: 'p1',
      channel: 'chat',
      callerPhone: null
    };

    const out = await runDeterministicPayment(state, ctx);
    expect(out).not.toBeNull();
    expect(out.toolsUsed).toContain('request_patient_payment');
    expect(out.reply).toMatch(/payment link/i);
  });
});
