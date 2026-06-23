#!/usr/bin/env node
'use strict';

/**
 * Commerce retirement gate: fail if /api/public/commerce/* traffic in lookback window.
 *
 * Usage:
 *   DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-commerce-traffic-zero.cjs --days 90
 */

const path = require('path');

function parseDays(argv) {
  const i = argv.indexOf('--days');
  if (i >= 0 && argv[i + 1]) return parseInt(argv[i + 1], 10);
  return parseInt(process.env.COMMERCE_TRAFFIC_LOOKBACK_DAYS || '90', 10);
}

function main() {
  const days = parseDays(process.argv.slice(2));
  const dbPath =
    process.env.DB_PATH ||
    path.join(__dirname, '../../var/db/middleware-dev.db');
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const patterns = ['%/api/public/commerce/%', '%/public/commerce/%', 'commerce_checkout%'];
  let totalHits = 0;
  const breakdown = {};

  // audit_events (if action/resource stores paths)
  try {
    const cols = db.prepare('PRAGMA table_info(audit_events)').all().map((c) => c.name);
    if (cols.includes('resource_type') && cols.includes('created_at')) {
      for (const p of patterns) {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS c FROM audit_events
             WHERE created_at >= ? AND (resource_type LIKE ? OR action LIKE ?)`
          )
          .get(cutoff, p, p);
        const n = Number(row?.c || 0);
        breakdown[`audit_events:${p}`] = n;
        totalHits += n;
      }
    }
  } catch (_) {}

  // ops_counters named commerce/*
  try {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(count), 0) AS c FROM ops_counters
         WHERE name LIKE 'commerce%' AND date >= date(?)`
      )
      .get(cutoff.slice(0, 10));
    const n = Number(row?.c || 0);
    breakdown['ops_counters:commerce%'] = n;
    totalHits += n;
  } catch (_) {}

  // voice_call_log / kelly events mentioning commerce checkout tool
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM kelly_call_events
         WHERE created_at >= ? AND (
           event_type LIKE '%commerce%' OR payload_json LIKE '%commerce%'
         )`
      )
      .get(cutoff);
    const n = Number(row?.c || 0);
    breakdown['kelly_call_events:commerce'] = n;
    totalHits += n;
  } catch (_) {}

  db.close();

  const report = {
    lookback_days: days,
    cutoff,
    total_hits: totalHits,
    breakdown,
    ready_for_deletion: totalHits === 0,
    note: 'Product sign-off still required before archiving patient-app/ or removing routes.',
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(totalHits > 0 ? 1 : 0);
}

main();
