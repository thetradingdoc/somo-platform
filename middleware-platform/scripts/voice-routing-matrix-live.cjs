#!/usr/bin/env node

/**

 * VFY-01 — Live routing matrix verify (extends PD-4).

 *

 * Usage:

 *   node scripts/voice-routing-matrix-live.cjs --smoke-only

 *   DB_PATH=./backups/prod.db node scripts/voice-routing-matrix-live.cjs --session call_xxx

 *   node scripts/voice-routing-matrix-live.cjs --pull-db --latest

 *   node scripts/voice-routing-matrix-live.cjs --pull-db --latest --tenant-book

 *   node scripts/voice-routing-matrix-live.cjs --pull-db --latest --fail-closed

 */

'use strict';



const path = require('path');

const { execSync } = require('child_process');



require('dotenv').config({ path: path.join(__dirname, '..', '.env') });



const smokeOnly = process.argv.includes('--smoke-only');
const checklistMode = process.argv.includes('--checklist');
const tenantBook = process.argv.includes('--tenant-book');

const failClosed = process.argv.includes('--fail-closed');

const sessionIdx = process.argv.indexOf('--session');

const sessionId = sessionIdx >= 0 ? process.argv[sessionIdx + 1] : null;

if (checklistMode) {
  console.log(`
==> Operator checklist (T-001 / PD-4)

T-001 Retell transfer (staging):
  1. Configure clinic transfer_number or CALLSOMO_OPERATOR_FALLBACK_PSTN
  2. External PSTN → staging tenant DID
  3. Force escalation (unidentified / agentBlocked / transfer_call)
  4. Retell log: WS frame with transfer_number + no_interruption_allowed
  5. Callee PSTN rings (pass criterion)
  6. Log call_id, date, operator in docs/runbooks/OPERATIONS.md
  7. If step 5 fails → request R-06-4 REST fallback

PD-4 live routing matrix:
  - demo: routing_world_resolved = demo
  - tenant: site verified
  - unidentified: fail-closed handoff
  - platform_support: admin handoff, no OPQRST
  - operator_outbound: site_context_status = not_required

CR live scripts: CR-029 … CR-037 (see VOICE_REMEDIATION_OPERATOR_GATES.md)
`);
  if (sessionId && process.env.DB_PATH) {
    const { openReadonlyDb } = require('./verify-live-shared.cjs');
    const db = openReadonlyDb(process.env.DB_PATH);
    const site = db
      .prepare(
        `SELECT site_context_status, clinic_id, customer_id FROM call_site_context WHERE session_id = ? LIMIT 1`
      )
      .get(sessionId);
    if (site) {
      console.log(`Session ${sessionId}: site=${site.site_context_status} clinic=${site.clinic_id || '—'}`);
    } else {
      console.warn(`No call_site_context row for session ${sessionId}`);
    }
  }
  process.exit(0);
}

if (smokeOnly || (!sessionId && !process.argv.includes('--latest') && !process.argv.includes('--pull-db'))) {

  console.log('==> Offline matrix smoke');

  execSync('node scripts/voice-routing-matrix-smoke.cjs', {

    cwd: path.join(__dirname, '..'),

    stdio: 'inherit'

  });

  if (smokeOnly) process.exit(0);

}



function assertTenantBook(db, callId) {

  const { parsePayload } = require('./verify-live-shared.cjs');

  const resolved = db

    .prepare(

      `SELECT payload_json FROM kelly_call_events

       WHERE (call_id = ? OR session_id = ?) AND event_type = 'call_site_context_resolved'

       ORDER BY created_at DESC LIMIT 1`

    )

    .get(callId, callId);

  if (!resolved) {
    return assertTenantBookRetell(callId);
  }

  const payload = parsePayload(resolved.payload_json);

  if (payload.site_context_status !== 'verified') {

    throw new Error(`T-013: expected verified site, got ${payload.site_context_status}`);

  }

  const opqrst = db

    .prepare(

      `SELECT 1 FROM kelly_call_events

       WHERE (call_id = ? OR session_id = ?) AND event_type LIKE '%opqrst%'

       LIMIT 1`

    )

    .get(callId, callId);

  if (opqrst) throw new Error('T-013: OPQRST event present on booking-style tenant call');

  console.log('✅ T-013 tenant-book verify passed');

}

async function assertTenantBookRetell(callId) {
  const {
    getCall,
    transcriptHasOpqrst,
    transcriptHasBooking
  } = require('./lib/verify-retell.cjs');
  const call = await getCall(callId);
  const transcript = String(call.transcript || '');
  if (transcriptHasOpqrst(transcript)) {
    throw new Error('T-013: OPQRST language in Retell transcript');
  }
  const tenantDid = process.env.CAPSTONE_TENANT_DID || process.env.PHASE1_TENANT_DID || '+18623622415';
  const toOk = String(call.to_number || '').replace(/\D/g, '') === tenantDid.replace(/\D/g, '');
  if (!toOk) {
    throw new Error(`T-013: expected tenant DID ${tenantDid}, got ${call.to_number}`);
  }
  const tenantKelly = /Kelly|front desk|Doctor Little|appointment|how can I help/i.test(transcript);
  if (!transcriptHasBooking(transcript) && !tenantKelly && call.duration_ms < 20000) {
    throw new Error('T-013: no booking/tenant signals in Retell transcript');
  }
  console.log(`✅ T-013 tenant-book verify passed (Retell fallback, ${callId})`);
}



function assertFailClosed(db, callId) {

  const row = db

    .prepare(

      `SELECT * FROM handoff_escalations

       WHERE call_id = ? OR session_id = ?

       ORDER BY created_at DESC LIMIT 1`

    )

    .get(callId, callId);

  if (!row) throw new Error('T-014: missing handoff_escalations row');

  console.log(`✅ T-014 fail-closed row outcome=${row.outcome} pstn=${row.pstn_target || 'none'}`);

}



if ((tenantBook || failClosed) && sessionId && process.env.DB_PATH) {
  const { openReadonlyDb } = require('./verify-live-shared.cjs');
  const db = openReadonlyDb(process.env.DB_PATH);
  (async () => {
    try {
      if (tenantBook) await assertTenantBook(db, sessionId);
      if (failClosed) assertFailClosed(db, sessionId);
      process.exit(0);
    } catch (e) {
      console.error(e.message || e);
      process.exit(1);
    }
  })();
} else {
  const pd4 = path.join(__dirname, 'pd-4-platform-live-verify.cjs');
  const args = process.argv.slice(2).filter((a) => a !== '--smoke-only');
  execSync(`node "${pd4}" ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });

  if ((tenantBook || failClosed) && process.env.DB_PATH) {
    const { openReadonlyDb, parseArgs } = require('./verify-live-shared.cjs');
    const opts = parseArgs(process.argv);
    const callId = opts.session || sessionId;
    if (callId) {
      const db = openReadonlyDb(process.env.DB_PATH);
      (async () => {
        try {
          if (tenantBook) await assertTenantBook(db, callId);
          if (failClosed) assertFailClosed(db, callId);
        } catch (e) {
          console.error(e.message || e);
          process.exit(1);
        }
      })();
    }
  }
}