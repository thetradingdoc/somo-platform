#!/usr/bin/env node
/**
 * Staged production rollout: outbound opener fix + conversation-mode per-rail enforce.
 *
 * Usage (from middleware-platform/):
 *   node scripts/rollout-voice-outbound-opener.cjs              # preflight + instructions
 *   node scripts/rollout-voice-outbound-opener.cjs --apply-db   # fix operator openers in DB
 *   node scripts/rollout-voice-outbound-opener.cjs --test-call 8622307479
 *
 * Requires: .env with Twilio + Retell + CALLSOMO_OPERATOR_CUSTOMER_ID
 * For prod DB fix: DB_PATH or CLOUDSQL proxy pointing at production SQLite/Postgres mirror.
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { gcsCp } = require('./gcs-cli-fallback.cjs');

const args = process.argv.slice(2);
const applyDb = args.includes('--apply-db');
const applyProdDb = args.includes('--apply-prod-db');
const dryRunDb = args.includes('--dry-run-db') || (!applyDb && !applyProdDb && !args.includes('--test-call'));
const testCallIdx = args.indexOf('--test-call');
const testPhone = testCallIdx >= 0 ? args[testCallIdx + 1] : null;

const baseUrl = (() => {
  const candidates = [
    process.env.TWILIO_OUTBOUND_WEBHOOK_URL,
    process.env.PUBLIC_API_BASE_URL,
    process.env.BASE_URL
  ].filter(Boolean);
  for (const raw of candidates) {
    const u = String(raw).replace(/\/$/, '');
    if (!/localhost|127\.0\.0\.1/i.test(u)) return u;
  }
  return 'https://api.callsomo.com';
})();

function operatorInDb() {
  const db = require('../database');
  const { getOperatorCustomerId } = require('../services/voice-account-resolution');
  const operatorId = getOperatorCustomerId();
  return operatorId && db.getCustomer(operatorId) ? operatorId : null;
}

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { encoding: 'utf8', stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

function check(name, ok, detail = '') {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function main() {
  console.log('=== Voice outbound opener + staged conversation-mode rollout ===\n');

  const checks = [
    check('TWILIO_ACCOUNT_SID', !!process.env.TWILIO_ACCOUNT_SID),
    check('TWILIO_AUTH_TOKEN', !!process.env.TWILIO_AUTH_TOKEN),
    check('TWILIO_PHONE_NUMBER', !!process.env.TWILIO_PHONE_NUMBER),
    check('RETELL_AGENT_ID', !!(process.env.RETELL_AGENT_ID || process.env.RETELL_SALES_AGENT_ID)),
    check('CALLSOMO_OPERATOR_CUSTOMER_ID', !!process.env.CALLSOMO_OPERATOR_CUSTOMER_ID),
    check('RETELL_API_KEY', !!process.env.RETELL_API_KEY)
  ];

  if (checks.some((c) => !c)) {
    console.error('\nFix missing env vars in .env before deploy.');
    process.exit(1);
  }

  console.log('\n--- Staged Cloud Run env (production profile) ---');
  console.log(`TWILIO_OUTBOUND_WEBHOOK_URL=${baseUrl}`);
  console.log('CONVERSATION_MODE_ROUTING=shadow');
  console.log('CONVERSATION_MODE_ENFORCE_OPERATOR_OUTBOUND=1');
  console.log('CONVERSATION_MODE_ENFORCE_OUTBOUND_SALES=1');
  console.log('\nDeploy: cd repo root && ./scripts/deploy-to-gcp-production.sh');
  console.log(
    'If production preserves env (default), update after deploy:\n' +
      `  gcloud run services update somo-middleware --region=us-central1 \\\n` +
      `    --update-env-vars TWILIO_OUTBOUND_WEBHOOK_URL=${baseUrl},` +
      `CONVERSATION_MODE_ROUTING=shadow,` +
      `CONVERSATION_MODE_ENFORCE_OPERATOR_OUTBOUND=1,` +
      `CONVERSATION_MODE_ENFORCE_OUTBOUND_SALES=1`
  );

  if (dryRunDb || applyDb || applyProdDb) {
    const bucket = process.env.GCS_DB_BUCKET || 'somo-staging-db-somo-callsomo';
    const object = process.env.GCS_DB_OBJECT || 'middleware-staging.db';
    const localDb = path.join(__dirname, '..', 'backups', 'middleware-staging.db');

    if (applyProdDb) {
      fs.mkdirSync(path.dirname(localDb), { recursive: true });
      const remote = `gs://${bucket}/${object}`;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupRemote = `gs://${bucket}/backups/middleware-staging-${stamp}.db`;
      console.log(`\n--- Prod DB: backup + download ${remote} ---`);
      try {
        gcsCp(remote, backupRemote);
      } catch (e) {
        console.warn('Backup skipped:', e.message);
      }
      gcsCp(remote, localDb);
      process.env.DB_PATH = localDb;
      delete require.cache[require.resolve('../database')];
    }

    let operatorId = operatorInDb();

    if (!operatorId) {
      console.warn(
        '\n⚠️  Operator customer not in this DB — skip DB fix locally.\n' +
          '   Point DB_PATH at production (or Cloud SQL proxy) then:\n' +
          '   node scripts/rollout-voice-outbound-opener.cjs --apply-db'
      );
      if (applyDb || applyProdDb) process.exit(1);
    } else {
      const flag = applyDb || applyProdDb ? '' : '--dry-run';
      run(`node scripts/fix-operator-voice-openers.cjs ${flag}`.trim());
      if (applyProdDb) {
        const remote = `gs://${bucket}/${object}`;
        console.log(`\n--- Upload patched DB to ${remote} ---`);
        gcsCp(localDb, remote);
        console.log('Restart Cloud Run after upload: gcloud run services update somo-middleware --region=us-central1');
      }
    }
  }

  if (testPhone) {
    run(
      `TWILIO_OUTBOUND_WEBHOOK_URL=${baseUrl} node scripts/make-outbound-call.js ${testPhone}`
    );
    console.log('\nAnswer the phone — expect outbound Kelly opener, not "you\'ve reached Somo owner".');
    console.log('Verify kelly_call_events for opener_used / conversation_mode_dispatch.');
  }

  console.log('\n--- Post-deploy smoke ---');
  console.log(`curl -sS ${baseUrl}/health/live`);
  console.log(`curl -sS ${baseUrl}/webhook/retell/llm`);
  console.log(
    'npm test -- __tests__/conversation-mode-v1-v14.test.js __tests__/conversation-mode-config.test.js'
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
