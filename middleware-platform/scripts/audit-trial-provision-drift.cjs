#!/usr/bin/env node
'use strict';

/**
 * List active trials where trial_provision_json claims Twilio provisioned but DID columns are empty.
 * Usage: node scripts/audit-trial-provision-drift.cjs
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.chdir(require('path').join(__dirname, '..'));

const db = require('../database');

function main() {
  const rows = db.db
    .prepare(
      `SELECT id, email, trial_status, twilio_phone_number, twilio_phone_sid, trial_provision_json
       FROM customers
       WHERE trial_status = 'active'`
    )
    .all();

  const drift = [];
  for (const row of rows) {
    const hasDid =
      !!(row.twilio_phone_number && String(row.twilio_phone_number).trim()) &&
      !!(row.twilio_phone_sid && String(row.twilio_phone_sid).trim());
    let json = {};
    try {
      json = row.trial_provision_json ? JSON.parse(row.trial_provision_json) : {};
    } catch (_) {}
    if (json.twilio_provisioned === true && !hasDid) {
      drift.push({ ...row, trial_provision_json: json });
    }
  }

  if (!drift.length) {
    console.log('OK: no active trials with twilio_provisioned=true and missing DID columns.');
    return;
  }

  console.log(`Found ${drift.length} drift row(s):\n`);
  for (const r of drift) {
    console.log(`  ${r.email} (${r.id})`);
    console.log(`    twilio_phone_number: ${r.twilio_phone_number || '(none)'}`);
    console.log(`    twilio_provision_error: ${r.trial_provision_json.twilio_provision_error || '(none)'}`);
  }
  process.exit(1);
}

main();
