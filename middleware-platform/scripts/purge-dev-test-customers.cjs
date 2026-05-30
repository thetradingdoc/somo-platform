#!/usr/bin/env node
/**
 * Remove dev/test SaaS customers (smoke, trial-e2e, @t.test).
 * Usage: npm run db:purge-test-tenants [-- --dry-run]
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const DRY = process.argv.includes('--dry-run');

const PATTERNS = [
  (email) => /@t\.test$/i.test(email),
  (email) => /smoke/i.test(email),
  (email) => /trial-e2e/i.test(email),
  (email) => /trial-smoke/i.test(email)
];

function isTestRow(row) {
  const email = String(row.email || '');
  return PATTERNS.some((fn) => fn(email));
}

function main() {
  const rows = db.db.prepare(`SELECT id, email FROM customers`).all();
  const targets = rows.filter(isTestRow);
  if (!targets.length) {
    console.log('No test customers matched.');
    return;
  }
  console.log(`${DRY ? '[dry-run] ' : ''}Purging ${targets.length} test customer(s):`);
  for (const t of targets) {
    console.log(`  - ${t.email} (${t.id})`);
    if (!DRY) {
      try {
        db.db.prepare(`DELETE FROM customer_sessions WHERE customer_id = ?`).run(t.id);
      } catch (_) {}
      db.db.prepare(`DELETE FROM customers WHERE id = ?`).run(t.id);
    }
  }
  console.log('Done.');
}

main();
