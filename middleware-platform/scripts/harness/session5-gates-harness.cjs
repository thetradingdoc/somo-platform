#!/usr/bin/env node
'use strict';

/**
 * Session 5 — negative gate scenarios (booking/quote/payment bypass).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const journeyGates = require('../../services/platform/journey-gates-service');
const KellyToolExecutor = require('../../services/kelly/kelly-tool-executor');

function assert(name, ok, detail) {
  if (!ok) {
    console.error(`FAIL ${name}`, detail || '');
    process.exit(2);
  }
  console.log(`PASS ${name}`);
}

async function main() {
  const sessionId = `neg_${Date.now()}`;

  const bookingBypass = journeyGates.checkBookingAfterQuoteGate({ sessionFlags: {} });
  assert('booking_bypass_blocked', !bookingBypass.allowed);
  assert('booking_holding_utterance', /copay/i.test(bookingBypass.holding_utterance));

  const quoteBypass = journeyGates.checkQuoteGate({ quoteResult: { status: 'cannot_determine' } });
  assert('quote_bypass_blocked', !quoteBypass.allowed);

  const paymentBypass = journeyGates.checkPaymentGate({ sessionFlags: {} });
  assert('payment_bypass_blocked', !paymentBypass.allowed);

  KellyToolExecutor._setSessionMeta(sessionId, 'quote_delivered', '0');
  const paymentStillBlocked = journeyGates.checkPaymentGate({
    sessionFlags: { quote_delivered: KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') }
  });
  assert('payment_blocked_without_quote_delivered', !paymentStillBlocked.allowed);

  console.log(JSON.stringify({ success: true, scenarios: 4 }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
