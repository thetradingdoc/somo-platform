#!/usr/bin/env node
'use strict';

/**
 * Clear dodgecall_demo_requests for local testing (IP / phone rate limits).
 * Usage: node scripts/clear-dodgecall-demo-rate-limits.cjs
 *        node scripts/clear-dodgecall-demo-rate-limits.cjs --phone=+15551234567
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../database');

const phoneArg = process.argv.find((a) => a.startsWith('--phone='));
const phone = phoneArg ? phoneArg.split('=')[1] : null;

if (phone) {
  const r = db.db.prepare('DELETE FROM dodgecall_demo_requests WHERE phone = ?').run(phone);
  console.log(`Deleted ${r.changes} row(s) for phone ${phone}`);
} else {
  const r = db.db.prepare(`DELETE FROM dodgecall_demo_requests`).run();
  console.log(`Deleted ${r.changes} dodgecall_demo_requests row(s)`);
}
