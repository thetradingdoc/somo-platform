#!/usr/bin/env node
/**
 * Dev-only tenant wipe. Requires ALLOW_DEV_WIPE=1 and non-production NODE_ENV.
 *
 *   ALLOW_DEV_WIPE=1 node scripts/wipe-dev-tenants.cjs --customer-id=cust_xxx [--dry-run]
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      out[a.slice(2, eq).replace(/-/g, '_')] = a.slice(eq + 1);
    } else if (a === '--dry-run') {
      out.dry_run = true;
    }
  }
  return out;
}

function main() {
  if (process.env.ALLOW_DEV_WIPE !== '1') {
    console.error('Set ALLOW_DEV_WIPE=1 to run this script.');
    process.exit(1);
  }
  const env = String(process.env.NODE_ENV || 'development').toLowerCase();
  if (env === 'production' || env === 'prod') {
    console.error('Refusing to wipe in production.');
    process.exit(1);
  }

  const { customer_id: customerId, dry_run: dryRun } = parseArgs();
  if (!customerId) {
    console.error('Required: --customer-id=');
    process.exit(1);
  }

  const customer = db.getCustomer(customerId);
  if (!customer) {
    console.error(`Not found: ${customerId}`);
    process.exit(1);
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}Wipe tenant ${customer.email || customerId}`);
  const tables = [
    ['customer_sessions', 'customer_id'],
    ['voice_call_log', 'customer_id'],
    ['sms_usage_log', 'customer_id']
  ];

  if (!dryRun) {
    for (const [table, col] of tables) {
      try {
        const r = db.db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(customerId);
        console.log(`  ${table}: ${r.changes} rows`);
      } catch (e) {
        console.warn(`  ${table}: skipped (${e.message})`);
      }
    }
    db.db.prepare(`DELETE FROM customers WHERE id = ?`).run(customerId);
  }

  console.log('Done. Remember: Stripe → Twilio → Retell in console before DB (see docs/runbooks/wipe-tenant-data.md).');
}

main();
