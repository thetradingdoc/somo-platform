#!/usr/bin/env node
/**
 * List SaaS customers with Twilio numbers and flag orphans (canceled + past retention).
 * Usage: node scripts/audit-voice-twilio-numbers.cjs [--json]
 */

'use strict';

const db = require('../database');

const asJson = process.argv.includes('--json');
const rows = db.db.prepare(`
  SELECT id, email, subscription_status, twilio_phone_number, twilio_phone_sid,
         number_retention_until, canceled_at
  FROM customers
  WHERE twilio_phone_sid IS NOT NULL AND twilio_phone_sid != ''
`).all();

const now = Date.now();
const orphans = rows.filter((r) => {
  if (!['canceled', 'suspended', 'unpaid'].includes(r.subscription_status)) return false;
  if (!r.number_retention_until) return true;
  return new Date(r.number_retention_until).getTime() <= now;
});

const report = {
  total_with_numbers: rows.length,
  release_candidates: orphans.length,
  orphans: orphans.map((r) => ({
    id: r.id,
    email: r.email,
    number: r.twilio_phone_number,
    status: r.subscription_status,
    retention_until: r.number_retention_until
  }))
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Numbers assigned: ${report.total_with_numbers}`);
  console.log(`Release candidates: ${report.release_candidates}`);
  report.orphans.forEach((o) => console.log(`  - ${o.id} ${o.number} (${o.status})`));
}
