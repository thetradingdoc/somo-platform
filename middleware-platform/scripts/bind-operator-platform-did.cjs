#!/usr/bin/env node
'use strict';

/**
 * Bind +13639990205 to operator customer; clear navigation-demo conflict.
 *
 * Usage (from middleware-platform/):
 *   node scripts/bind-operator-platform-did.cjs
 *   node scripts/bind-operator-platform-did.cjs --dry-run
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const Database = require('better-sqlite3');
const { getOperatorCustomerId } = require('../services/voice-account-resolution');
const { resolveNavCustomerId } = require('./lib/navigation-demo-config.cjs');
const { platformDid } = require('../services/platform-line-config');

const dryRun = process.argv.includes('--dry-run');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'middleware.db');

function main() {
  const operatorId = getOperatorCustomerId();
  if (!operatorId) {
    console.error('CALLSOMO_OPERATOR_CUSTOMER_ID not set');
    process.exit(1);
  }

  const did = platformDid();
  const navId = resolveNavCustomerId();
  const sqlite = new Database(dbPath);

  try {
    const operator = sqlite.prepare('SELECT id, twilio_phone_number FROM customers WHERE id = ?').get(operatorId);
    if (!operator) {
      console.error(`Operator customer ${operatorId} not found in ${dbPath}`);
      process.exit(1);
    }

    const conflicts = sqlite
      .prepare('SELECT id, customer_type FROM customers WHERE twilio_phone_number = ? AND id != ?')
      .all(did, operatorId);

    console.log(`Platform DID: ${did}`);
    console.log(`Operator:     ${operatorId}`);
    console.log(`Navigation:   ${navId}`);

    if (dryRun) {
      console.log('[dry-run] Would clear conflicts:', conflicts.map((c) => c.id).join(', ') || '(none)');
      console.log(`[dry-run] Would set operator.twilio_phone_number = ${did}`);
      console.log(`[dry-run] Would clear navigation-demo DID if bound`);
      return;
    }

    for (const row of conflicts) {
      sqlite
        .prepare(
          `UPDATE customers SET twilio_phone_number = NULL, updated_at = datetime('now') WHERE id = ?`
        )
        .run(row.id);
      console.log(`✅ Cleared ${did} from ${row.id} (${row.customer_type || 'unknown'})`);
    }

    sqlite
      .prepare(
        `UPDATE customers SET twilio_phone_number = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(did, operatorId);
    console.log(`✅ Bound ${did} → operator ${operatorId}`);

    if (navId && navId !== operatorId) {
      const nav = sqlite.prepare('SELECT twilio_phone_number FROM customers WHERE id = ?').get(navId);
      if (nav?.twilio_phone_number === did) {
        sqlite
          .prepare(
            `UPDATE customers SET twilio_phone_number = NULL, updated_at = datetime('now') WHERE id = ?`
          )
          .run(navId);
        console.log(`✅ Cleared ${did} from navigation-demo ${navId}`);
      }
    }
  } finally {
    sqlite.close();
  }
}

main();
