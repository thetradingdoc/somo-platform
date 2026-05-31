#!/usr/bin/env node
'use strict';

/**
 * Assert trial + Twilio fields on staging customer row.
 *
 * Usage:
 *   STAGING_DB_PATH=./backups/middleware-staging.db \
 *     node scripts/staging-db-assert-customer.cjs --email=trial-e2e-staging-123@example.com
 *   node scripts/staging-db-assert-customer.cjs --customer-id=abc-123
 */

const {
  getCustomerByEmail,
  getCustomerById,
  assertTrialCustomer,
  resolveDbPath
} = require('./staging-db-utils.cjs');

function parseArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

function main() {
  const email = parseArg('email');
  const customerId = parseArg('customer-id');
  if (!email && !customerId) {
    console.error('Usage: --email=... or --customer-id=...');
    process.exit(1);
  }

  console.log('DB:', resolveDbPath());
  const customer = customerId ? getCustomerById(customerId) : getCustomerByEmail(email);
  const errors = assertTrialCustomer(customer);
  if (errors.length) {
    console.error('\nFAIL:', errors.join('\n'));
    console.error('\nCustomer snapshot:', {
      id: customer.id,
      email: customer.email,
      trial_status: customer.trial_status,
      phone_verified: customer.phone_verified,
      twilio_phone_number: customer.twilio_phone_number,
      twilio_phone_sid: customer.twilio_phone_sid,
      retell_agent_id: customer.retell_agent_id
    });
    process.exit(1);
  }

  console.log('OK: trial customer', customer.id, customer.twilio_phone_number);
  console.log(
    JSON.stringify(
      {
        customer_id: customer.id,
        email: customer.email,
        twilio_phone_number: customer.twilio_phone_number,
        twilio_phone_sid: customer.twilio_phone_sid,
        merchant_id: customer.merchant_id,
        retell_agent_id: customer.retell_agent_id || null
      },
      null,
      2
    )
  );
}

main();
