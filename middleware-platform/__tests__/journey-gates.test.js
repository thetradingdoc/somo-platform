'use strict';

const journeyGates = require('../services/journey-gates-service');

describe('journey-gates-service', () => {
  test('blocks payment without quote_delivered', () => {
    const gate = journeyGates.checkPaymentGate({ sessionFlags: {} });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('quote_not_delivered');
  });

  test('allows payment when quote_delivered', () => {
    const gate = journeyGates.checkPaymentGate({ sessionFlags: { quote_delivered: true } });
    expect(gate.allowed).toBe(true);
  });

  test('allows payment when quote_delivered is string 1', () => {
    const gate = journeyGates.checkPaymentGate({ sessionFlags: { quote_delivered: '1' } });
    expect(gate.allowed).toBe(true);
  });

  test('blocks hard quote when status not hard_number', () => {
    const gate = journeyGates.checkQuoteGate({ quoteResult: { status: 'cannot_determine' } });
    expect(gate.allowed).toBe(false);
  });

  test('allows hard quote when status hard_number', () => {
    const gate = journeyGates.checkQuoteGate({ quoteResult: { status: 'hard_number' } });
    expect(gate.allowed).toBe(true);
  });

  test('blocks booking before quote delivered', () => {
    const gate = journeyGates.checkBookingAfterQuoteGate({ sessionFlags: {} });
    expect(gate.allowed).toBe(false);
  });

  test('allows booking after quote delivered string 1', () => {
    const gate = journeyGates.checkBookingAfterQuoteGate({ sessionFlags: { quote_delivered: '1' } });
    expect(gate.allowed).toBe(true);
  });
});
