#!/usr/bin/env node
'use strict';

/**
 * Read-only report: duplicate identities across users + customers (W4-07c).
 * Usage: node scripts/audit-duplicate-identities.cjs
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function normEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function main() {
  const users = db.db.prepare('SELECT id, email, merchant_id, clinic_id FROM users WHERE email IS NOT NULL').all();
  const customers = db.db
    .prepare('SELECT id, email, merchant_id, customer_type FROM customers WHERE email IS NOT NULL')
    .all();

  const byEmail = new Map();

  for (const u of users) {
    const e = normEmail(u.email);
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, { users: [], customers: [] });
    byEmail.get(e).users.push(u);
  }
  for (const c of customers) {
    const e = normEmail(c.email);
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, { users: [], customers: [] });
    byEmail.get(e).customers.push(c);
  }

  const duplicates = [];
  for (const [email, group] of byEmail) {
    if (group.users.length + group.customers.length <= 1) continue;
    if (group.users.length && group.customers.length) {
      duplicates.push({ email, ...group, kind: 'users+customers' });
    } else if (group.users.length > 1) {
      duplicates.push({ email, ...group, kind: 'multiple_users' });
    } else if (group.customers.length > 1) {
      duplicates.push({ email, ...group, kind: 'multiple_customers' });
    }
  }

  console.log('\nDuplicate identity audit\n');
  console.log(`  users:     ${users.length}`);
  console.log(`  customers: ${customers.length}`);
  console.log(`  conflicts: ${duplicates.length}\n`);

  if (!duplicates.length) {
    console.log('✅ No duplicate email conflicts found.\n');
    return;
  }

  for (const d of duplicates) {
    console.log(`— ${d.email} (${d.kind})`);
    d.users.forEach((u) => console.log(`    user     ${u.id} merchant=${u.merchant_id || '(none)'}`));
    d.customers.forEach((c) =>
      console.log(`    customer ${c.id} type=${c.customer_type || '?'} merchant=${c.merchant_id || '(none)'}`)
    );
  }
  console.log('\nPolicy: merge manually per docs/auth/LEGACY_SIGNUP_AUDIT.md — do not auto-delete.\n');
}

main();
