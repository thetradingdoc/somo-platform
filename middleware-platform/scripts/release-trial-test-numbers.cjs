#!/usr/bin/env node
'use strict';

/**
 * Release Twilio numbers bought during trial-smoke / trial-e2e runs.
 * Usage: node scripts/release-trial-test-numbers.cjs [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../database');
const TwilioPhoneService = require('../services/voice/twilio-phone-service');

const dryRun = process.argv.includes('--dry-run');

function getTrialTestCustomers() {
  const Database = require('better-sqlite3');
  const path = require('path');
  const dbPath = process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : path.join(__dirname, '..', 'middleware-dev.db');
  const conn = new Database(dbPath, { readonly: true });
  const rows = conn
    .prepare(
      `SELECT id, twilio_phone_sid AS sid, twilio_phone_number AS number
       FROM customers
       WHERE twilio_phone_sid IS NOT NULL AND TRIM(twilio_phone_sid) != ''
         AND (email LIKE 'trial-smoke%' OR email LIKE 'trial-e2e%')`
    )
    .all();
  conn.close();
  const bySid = new Map();
  for (const row of rows) {
    if (!bySid.has(row.sid)) bySid.set(row.sid, { sid: row.sid, number: row.number, customerIds: [] });
    bySid.get(row.sid).customerIds.push(row.id);
  }
  return [...bySid.values()];
}

async function main() {
  const numbers = getTrialTestCustomers();
  if (!numbers.length) {
    console.log('No trial test numbers to release.');
    return;
  }

  console.log(`Found ${numbers.length} number(s) to release:`);
  for (const n of numbers) console.log(`  ${n.number} (${n.sid})`);

  if (dryRun) {
    console.log('\nDry run — no changes.');
    return;
  }

  const twilio = new TwilioPhoneService();
  if (!twilio.isAvailable()) {
    console.error('Twilio not configured.');
    process.exit(1);
  }

  for (const { sid, number, customerIds } of numbers) {
    try {
      await twilio.releasePhoneNumber(sid);
      console.log(`Released ${number}`);
    } catch (e) {
      if (e.response?.status === 404) {
        console.warn(`Already gone in Twilio: ${number}`);
      } else {
        console.error(`Failed ${number}:`, e.message);
        continue;
      }
    }
    for (const id of customerIds) {
      db.updateCustomer(id, { twilio_phone_number: null, twilio_phone_sid: null });
    }
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
