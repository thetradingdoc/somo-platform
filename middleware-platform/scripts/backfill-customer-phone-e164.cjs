#!/usr/bin/env node
/**
 * Normalize customers.phone_number and customers.twilio_phone_number to E.164 where possible.
 * Safe to run multiple times (idempotent for already-normal rows).
 *
 *   cd middleware-platform && node scripts/backfill-customer-phone-e164.cjs
 *   DRY_RUN=1 node scripts/backfill-customer-phone-e164.cjs
 */
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();

const database = require('../database');
const { normalizeToE164 } = require('../utils/phone-e164');

const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const db = database.db;

function run() {
  const rows = db
    .prepare(
      `SELECT id, phone_number, twilio_phone_number FROM customers
       WHERE (phone_number IS NOT NULL AND TRIM(phone_number) != '')
          OR (twilio_phone_number IS NOT NULL AND TRIM(twilio_phone_number) != '')`
    )
    .all();

  let nPhone = 0;
  let nTwilio = 0;
  const updPhone = db.prepare(
    'UPDATE customers SET phone_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  );
  const updTwilio = db.prepare(
    'UPDATE customers SET twilio_phone_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  );

  for (const r of rows) {
    const id = r.id;
    if (r.phone_number) {
      const next = normalizeToE164(r.phone_number);
      if (next && next !== r.phone_number) {
        if (DRY) console.log('[dry-run] phone_number', id, r.phone_number, '->', next);
        else updPhone.run(next, id);
        nPhone += 1;
      }
    }
    if (r.twilio_phone_number) {
      const next = normalizeToE164(r.twilio_phone_number);
      if (next && next !== r.twilio_phone_number) {
        if (DRY) console.log('[dry-run] twilio_phone_number', id, r.twilio_phone_number, '->', next);
        else updTwilio.run(next, id);
        nTwilio += 1;
      }
    }
  }

  console.log(
    DRY ? 'backfill-customer-phone-e164: dry run complete' : 'backfill-customer-phone-e164: complete',
    { rows_scanned: rows.length, phone_updates: nPhone, twilio_updates: nTwilio, dry_run: DRY }
  );
}

try {
  run();
} catch (e) {
  console.error(e);
  process.exit(1);
}
