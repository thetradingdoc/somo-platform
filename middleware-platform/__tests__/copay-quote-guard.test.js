'use strict';

const { sanitizeCopayUtterance, quoteDeliveredForSession } = require('../services/copay-quote-guard');

describe('copay-quote-guard', () => {
  test('sanitizeCopayUtterance strips dollars when speak disabled', () => {
    const KellyToolExecutor = require('../services/kelly-tool-executor');
    const sessionId = `guard_test_${Date.now()}`;
    KellyToolExecutor._setSessionMeta(sessionId, 'quote_delivered', '0');
    const out = sanitizeCopayUtterance('Your copay today is $35.', {
      clinicId: 'clinic-default',
      sessionId
    });
    expect(out).not.toMatch(/\$35/);
  });

  test('quoteDeliveredForSession reads meta', () => {
    const KellyToolExecutor = require('../services/kelly-tool-executor');
    const sessionId = `guard_qd_${Date.now()}`;
    KellyToolExecutor._setSessionMeta(sessionId, 'quote_delivered', '1');
    expect(quoteDeliveredForSession(sessionId)).toBe(true);
  });
});
