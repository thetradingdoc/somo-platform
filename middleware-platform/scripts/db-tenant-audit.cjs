#!/usr/bin/env node
/**
 * Read-only tenant / voice readiness counts.
 * Usage: npm run db:tenant-audit
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function count(sql) {
  return db.db.prepare(sql).get().n;
}

function main() {
  const dbPath = db.sqliteDatabasePath || '(unknown)';
  console.log(`Database: ${dbPath}\n`);

  console.log('Tenants:');
  console.log(`  customers:  ${count('SELECT COUNT(*) AS n FROM customers')}`);
  console.log(`  merchants:  ${count('SELECT COUNT(*) AS n FROM merchants')}`);
  console.log(`  clinics:    ${count('SELECT COUNT(*) AS n FROM clinics')}`);
  console.log(`  users:      ${count('SELECT COUNT(*) AS n FROM users')}`);

  console.log('\nSaaS voice readiness:');
  console.log(
    `  with twilio: ${count("SELECT COUNT(*) AS n FROM customers WHERE twilio_phone_number IS NOT NULL AND twilio_phone_number != ''")}`
  );
  console.log(
    `  with retell: ${count("SELECT COUNT(*) AS n FROM customers WHERE retell_agent_id IS NOT NULL AND retell_agent_id != ''")}`
  );
  console.log(
    `  saas w/ merchant: ${count("SELECT COUNT(*) AS n FROM customers WHERE customer_type = 'saas' AND merchant_id IS NOT NULL AND merchant_id != ''")}`
  );

  console.log('\nRecent voice_call_log (7d):');
  const recent = db.db
    .prepare(
      `SELECT customer_id, COUNT(*) AS n FROM voice_call_log
       WHERE created_at > datetime('now', '-7 days')
       GROUP BY customer_id ORDER BY n DESC LIMIT 10`
    )
    .all();
  if (!recent.length) console.log('  (none)');
  else recent.forEach((r) => console.log(`  ${r.customer_id || '(null)'}: ${r.n}`));
}

main();
