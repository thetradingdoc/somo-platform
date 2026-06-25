#!/usr/bin/env node
'use strict';

/**
 * Retell-based PD-4 world verify when GCS SQLite has no kelly_call_events.
 *
 * Usage:
 *   node scripts/phase1-retell-verify.cjs --world demo|tenant|unidentified|platform_support|operator_outbound|booking --session call_xxx
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const {
  getCall,
  transcriptHasOpqrst,
  transcriptHasDemo,
  transcriptHasBooking,
  transcriptHasEscalation
} = require('./lib/verify-retell.cjs');

const PLATFORM_DID = process.env.CALLSOMO_OPERATOR_TWILIO_NUMBER || '+13639990205';
const TENANT_DID = process.env.CAPSTONE_TENANT_DID || '+18623622415';

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function verify(world, sessionId) {
  const call = await getCall(sessionId);
  const transcript = String(call.transcript || '');
  const base = {
    world,
    session_id: sessionId,
    to_number: call.to_number,
    from_number: call.from_number,
    duration_ms: call.duration_ms,
    opqrst: transcriptHasOpqrst(transcript),
    pass: false
  };

  switch (world) {
    case 'demo':
      base.pass =
        String(call.to_number).replace(/\D/g, '') === PLATFORM_DID.replace(/\D/g, '') &&
        !base.opqrst &&
        transcriptHasDemo(transcript);
      base.pass_reason = base.pass ? 'retell_demo_no_opqrst' : 'demo_check_failed';
      break;
    case 'tenant':
      base.pass =
        String(call.to_number).replace(/\D/g, '') === TENANT_DID.replace(/\D/g, '') &&
        !base.opqrst &&
        /Kelly|front desk|appointment|Doctor Little/i.test(transcript);
      base.pass_reason = base.pass ? 'retell_tenant_kelly' : 'tenant_check_failed';
      break;
    case 'unidentified':
    case 'fail-closed':
      base.pass = transcriptHasEscalation(transcript) || /cannot help|escalat|transfer|connect you/i.test(transcript);
      base.pass_reason = base.pass ? 'retell_escalation_language' : 'fail_closed_check_failed';
      break;
    case 'platform_support':
      base.pass =
        !base.opqrst &&
        String(call.to_number).replace(/\D/g, '') === PLATFORM_DID.replace(/\D/g, '') &&
        (/Kelly from Somo|support|admin|account|operator|quick call/i.test(transcript) ||
          transcriptHasDemo(transcript));
      base.pass_reason = base.pass ? 'retell_platform_support_signals' : 'platform_support_check_failed';
      break;
    case 'operator_outbound':
      base.pass =
        String(call.direction || '').toLowerCase().includes('outbound') ||
        String(call.from_number).replace(/\D/g, '') === PLATFORM_DID.replace(/\D/g, '');
      base.pass_reason = base.pass ? 'retell_outbound_from_platform' : 'outbound_check_failed';
      break;
    case 'booking':
      base.pass =
        String(call.to_number).replace(/\D/g, '') === TENANT_DID.replace(/\D/g, '') &&
        (transcriptHasBooking(transcript) || /schedule|confirmed|booked/i.test(transcript)) &&
        !base.opqrst;
      base.pass_reason = base.pass ? 'retell_booking_signals' : 'booking_check_failed';
      break;
    default:
      throw new Error(`Unknown world: ${world}`);
  }

  base.transcript_excerpt = transcript.slice(0, 500);
  console.log(JSON.stringify(base, null, 2));
  process.exit(base.pass ? 0 : 1);
}

const world = getArg('--world');
const session = getArg('--session');
if (!world || !session) {
  console.error('Usage: --world <name> --session call_xxx');
  process.exit(2);
}

verify(world, session).catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
