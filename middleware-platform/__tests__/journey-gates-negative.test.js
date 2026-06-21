'use strict';

const journeyGates = require('../services/journey-gates-service');

describe('journey-gates negative scenarios', () => {
  test('booking bypass blocked without quote_delivered', () => {
    const gate = journeyGates.checkBookingAfterQuoteGate({ sessionFlags: { quote_delivered: '0' } });
    expect(gate.allowed).toBe(false);
    expect(gate.holding_utterance).toMatch(/copay/i);
  });

  test('quote bypass blocked for cannot_determine', () => {
    const gate = journeyGates.checkQuoteGate({ quoteResult: { status: 'cannot_determine' } });
    expect(gate.allowed).toBe(false);
    expect(gate.holding_utterance).toMatch(/coverage/i);
  });

  test('payment bypass blocked without quote_delivered', () => {
    const gate = journeyGates.checkPaymentGate({ sessionFlags: {} });
    expect(gate.allowed).toBe(false);
    expect(gate.holding_utterance).toMatch(/copay/i);
  });

  test('coding gate blocks low confidence', () => {
    const gate = journeyGates.checkCodingGate({
      sessionId: 'sess_neg',
      triageRow: { triage_complete: 1 },
      db: {}
    });
    expect(gate.allowed).toBe(false);
  });
});
