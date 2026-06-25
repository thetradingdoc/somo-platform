#!/usr/bin/env node
'use strict';

/**
 * After operator PSTN calls, record call_ids and run Phase 1 verification.
 *
 * Usage:
 *   node scripts/phase1-report-operator-calls.cjs --t001 call_xxx [--t001-rang yes]
 *   node scripts/phase1-report-operator-calls.cjs --booking call_xxx
 *   node scripts/phase1-report-operator-calls.cjs --t001 call_aaa --booking call_bbb --t001-rang yes
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'backups', 'middleware-staging.db');
const STATUS_PATH = path.join(__dirname, '..', 'var', 'evidence', 'phase1', 'OPERATOR_STATUS.json');
const OPS_MD = path.join(ROOT, 'docs', 'runbooks', 'OPERATIONS.md');

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function loadStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  } catch (_) {
    return { steps: {} };
  }
}

function saveStatus(st) {
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(st, null, 2) + '\n');
}

function pullDb() {
  execSync(`bash "${path.join(ROOT, 'scripts', 'phase1-pull-prod-db.sh')}"`, { stdio: 'inherit' });
}

function verifyBooking(sessionId) {
  execSync('npm run verify:live-booking-call:strict -- --session ' + JSON.stringify(sessionId), {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, DB_PATH, SESSION_ID: sessionId, PHASE1_STRICT: '1' }
  });
}

function appendOps(section) {
  if (!fs.existsSync(OPS_MD)) return;
  fs.appendFileSync(OPS_MD, '\n' + section + '\n');
}

async function main() {
  const t001 = getArg('--t001');
  const booking = getArg('--booking');
  const t001Rang = getArg('--t001-rang') || 'yes';

  if (!t001 && !booking) {
    console.error(`Usage:
  node scripts/phase1-report-operator-calls.cjs --t001 call_xxx [--t001-rang yes|no]
  node scripts/phase1-report-operator-calls.cjs --booking call_xxx`);
    process.exit(2);
  }

  pullDb();
  const st = loadStatus();
  const date = new Date().toISOString().slice(0, 10);

  if (t001) {
    const rang = t001Rang === 'yes';
    st.steps.t001_pstn_ring = {
      pass: rang,
      session_id: t001,
      at: new Date().toISOString(),
      notes: rang ? 'External PSTN rang operator mobile' : 'Ring test failed'
    };
    appendOps(
      `### T-001 pass log (${date})\n` +
        `- call_id: \`${t001}\`\n` +
        `- DID: +18623622415\n` +
        `- Transfer target: ${st.transfer_fallback_pstn || '+18622307479'}\n` +
        `- PSTN rang: **${rang ? 'yes' : 'no'}**\n` +
        `- Result: **${rang ? 'PASS' : 'FAIL'}**\n`
    );
    execSync(
      `node scripts/phase1-operator-gate.cjs mark --step t001-ring --session ${JSON.stringify(t001)} --notes "PSTN rang ${t001Rang}"`,
      { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
    );
    console.log(rang ? '✅ T-001 ring recorded PASS' : '❌ T-001 ring recorded FAIL');
  }

  if (booking) {
    console.log(`\n==> Strict booking verify: ${booking}`);
    verifyBooking(booking);
    st.steps.booking_schedule_tool = {
      pass: true,
      session_id: booking,
      at: new Date().toISOString()
    };
    appendOps(
      `### Booking pass log (${date})\n` +
        `- call_id: \`${booking}\`\n` +
        `- verify:live-booking-call:strict PASS\n`
    );
    console.log('✅ Booking verify PASS');
  }

  saveStatus(st);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
