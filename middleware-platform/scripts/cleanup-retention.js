#!/usr/bin/env node
/**
 * Data Retention Cleanup (Section 21)
 *
 * Deletes records older than retention policy. Run via cron (e.g. daily).
 * Usage: node scripts/cleanup-retention.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const retention = require('../config/retention-policy');
const db = require('../database');

const dryRun = process.argv.includes('--dry-run');

function cutoffDays(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function run() {
  console.log(dryRun ? '\n📋 Retention cleanup (DRY RUN)' : '\n🧹 Data retention cleanup');
  console.log('─'.repeat(40));

  const tables = [
    ['voice_call_log', 'created_at', retention.voice_call_log],
    ['llm_usage_log', 'created_at', retention.llm_usage_log],
    ['function_call_log', 'created_at', retention.function_call_log],
    ['kelly_conversation_history', 'created_at', retention.kelly_conversation_history],
    ['triage_sessions', 'created_at', retention.triage_sessions]
  ];

  let totalDeleted = 0;
  for (const [table, dateCol, days] of tables) {
    const since = cutoffDays(days);
    try {
      const count = db.db.prepare(
        `SELECT COUNT(*) as n FROM ${table} WHERE ${dateCol} < ?`
      ).get(since)?.n ?? 0;
      if (count > 0) {
        console.log(`  ${table}: ${count} rows older than ${days}d`);
        if (!dryRun) {
          db.db.prepare(`DELETE FROM ${table} WHERE ${dateCol} < ?`).run(since);
          totalDeleted += count;
        }
      }
    } catch (e) {
      console.warn(`  ⚠️  ${table}: ${e.message}`);
    }
  }

  // Video consult (P2 retention)
  if (retention.video_consult_sessions && !dryRun) {
    try {
      const vcResult = db.cleanupVideoConsultData(retention.video_consult_sessions);
      totalDeleted += vcResult.deleted || 0;
    } catch (e) {
      console.warn('  ⚠️  video_consult cleanup:', e.message);
    }
  }

  // hipaa_access_log: 7 years retention (HIPAA requirement - delete only after 7 years)
  if (retention.hipaa_access_log) {
    try {
      const halTable = 'hipaa_access_log';
      const halSince = cutoffDays(retention.hipaa_access_log);
      const halCount = db.db.prepare(`SELECT COUNT(*) as n FROM ${halTable} WHERE created_at < ?`).get(halSince)?.n ?? 0;
      if (halCount > 0) {
        console.log(`  ${halTable}: ${halCount} rows older than ${retention.hipaa_access_log}d (7 years)${dryRun ? ' (would delete)' : ''}`);
        if (!dryRun) {
          db.db.prepare(`DELETE FROM ${halTable} WHERE created_at < ?`).run(halSince);
          totalDeleted += halCount;
        }
      }
    } catch (e) {
      if (e.message && !e.message.includes('no such table')) console.warn(`  ⚠️  hipaa_access_log: ${e.message}`);
    }
  }

  // coding_decisions: 7 years - rarely run full purge
  const cdDays = retention.coding_decisions;
  const cdSince = cutoffDays(cdDays);
  try {
    const cdCount = db.db.prepare(
      `SELECT COUNT(*) as n FROM coding_decisions WHERE created_at < ?`
    ).get(cdSince)?.n ?? 0;
    if (cdCount > 0 && !dryRun) {
      console.log(`  coding_decisions: ${cdCount} rows older than ${cdDays}d (7 years)`);
      db.db.prepare('DELETE FROM coding_decisions WHERE created_at < ?').run(cdSince);
      totalDeleted += cdCount;
    } else if (cdCount > 0 && dryRun) {
      console.log(`  coding_decisions: ${cdCount} rows would be deleted`);
    }
  } catch (e) {
    if (e.message && !e.message.includes('no such table')) console.warn(`  ⚠️  coding_decisions: ${e.message}`);
  }

  console.log(dryRun ? '\n  (No changes - dry run)' : `\n✅ Deleted ${totalDeleted} rows`);
}

run();
