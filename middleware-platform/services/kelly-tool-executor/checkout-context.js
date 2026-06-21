'use strict';

const CHECKOUT_STAGES = Object.freeze({
  COLLECTING_DETAILS: 'collecting_details',
  CODE_SENT: 'code_sent',
  CODE_VERIFIED: 'code_verified',
  CHECKOUT_PREPARED: 'checkout_prepared',
  PAYMENT_CONFIRMED: 'payment_confirmed',
  FAILED: 'failed'
});

module.exports = { CHECKOUT_STAGES };
