#!/usr/bin/env node
'use strict';

/**
 * Post-inbound-call verification against staging DB.
 *
 * Usage (after placing PSTN call to tenant DID):
 *   STAGING_DB_PATH=./backups/middleware-staging.db \
 *     node scripts/staging-call-verify.cjs --customer-id=<id>
 *   node scripts/staging-call-verify.cjs --customer-id=<id> --within-minutes=15
 *
 * Optional: reject if latest call belongs to wrong tenant (owner bleed).
 *   SOMO_OWNER_EMAIL=drlittlekids@gmail.com node scripts/staging-call-verify.cjs --customer-id=<trial-id>
 */

const {
  getCustomerById,
  getOwnerCustomer,
  latestVoiceCallForCustomer,
  resolveDbPath
} = require('./staging-db-utils.cjs');

function parseArg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=').slice(1).join('=');
  return fallback;
}

function main() {
  const customerId = parseArg('customer-id', '');
  const withinMinutes = Number(parseArg('within-minutes', '30')) || 30;
  if (!customerId) {
    console.error('Usage: --customer-id=<uuid>');
    process.exit(1);
  }

  console.log('DB:', resolveDbPath());
  const customer = getCustomerById(customerId);
  const row = latestVoiceCallForCustomer(customerId, withinMinutes);
  if (!row) {
    console.error(
      `FAIL: no voice_call_log row for customer_id=${customerId} in last ${withinMinutes} minutes`
    );
    console.error('Place inbound call to', customer.twilio_phone_number || '(no number)');
    process.exit(1);
  }

  if (row.customer_id !== customerId) {
    console.error(`FAIL: voice_call_log.customer_id=${row.customer_id} expected ${customerId}`);
    process.exit(1);
  }

  let ownerWarn = '';
  try {
    const owner = getOwnerCustomer();
    if (owner.id !== customerId) {
      const ownerRow = latestVoiceCallForCustomer(owner.id, withinMinutes);
      if (ownerRow && ownerRow.call_id === row.call_id) {
        console.error(
          'FAIL: latest call is attributed to owner, not trial customer (akin-dunbar / wrong tenant)'
        );
        process.exit(1);
      }
      if (ownerRow) {
        ownerWarn = `Note: owner also has a recent call ${ownerRow.call_id}`;
      }
    }
  } catch (_) {
    /* SOMO_OWNER_EMAIL optional */
  }

  console.log('OK: inbound call logged');
  console.log(
    JSON.stringify(
      {
        call_id: row.call_id,
        customer_id: row.customer_id,
        created_at: row.created_at,
        twilio_phone_number: customer.twilio_phone_number
      },
      null,
      2
    )
  );
  if (ownerWarn) console.log(ownerWarn);
}

main();
