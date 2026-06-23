#!/usr/bin/env node
'use strict';

/**
 * Session 4 — Kelly compute_visit_quote tool path + quote_audit evidence.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const KellyToolExecutor = require('../../services/kelly/kelly-tool-executor');
const db = require('../../database');
const { seedPaulTriage } = require('../lib/paul-harness-seed');

async function main() {
  const sessionId = `s4_kelly_quote_${Date.now()}`;
  seedPaulTriage(db, sessionId);

  const result = await KellyToolExecutor.execute('compute_visit_quote', {
    payer_id: 'BCBS_PILOT',
    plan_id: 'plan_x'
  }, { sessionId, clinicId: 'clinic-default' });

  const audit = db.db.prepare(
    'SELECT id, status, copay_due_now FROM quote_audit WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId);

  const ok = result?.quote?.status === 'hard_number' && audit?.status === 'hard_number' && audit.copay_due_now === 35;
  console.log(JSON.stringify({ sessionId, result, audit, success: ok }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
