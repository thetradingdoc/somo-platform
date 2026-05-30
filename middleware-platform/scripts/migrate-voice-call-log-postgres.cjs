#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Idempotent Postgres migration for voice_call_log analytics columns.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate-voice-call-log-postgres.cjs
 *
 * Or with project Postgres helper:
 *   node scripts/migrate-voice-call-log-postgres.cjs
 */
'use strict';

require('dotenv').config();

const postgres = require('postgres');

const MIGRATION_SQL = `
ALTER TABLE voice_call_log ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE voice_call_log ADD COLUMN IF NOT EXISTS caller_label TEXT;
ALTER TABLE voice_call_log ADD COLUMN IF NOT EXISTS caller_phone TEXT;
CREATE INDEX IF NOT EXISTS idx_voice_call_log_outcome ON voice_call_log(outcome);
`;

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    console.error('❌ Set DATABASE_URL or POSTGRES_URL to run this migration.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(MIGRATION_SQL);
    console.log('✅ voice_call_log columns ensured: outcome, caller_label, caller_phone');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('❌ Migration failed:', e.message);
  process.exit(1);
});
