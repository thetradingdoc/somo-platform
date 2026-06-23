#!/usr/bin/env node
/**
 * V-4: Platform voice routing matrix smoke (no PSTN).
 * Usage: node scripts/voice/voice-routing-matrix-smoke.cjs
 */
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const {
  resolveRoutingWorld,
  isTenantResolvedForMode,
  shouldBlockKellyTurn
} = require('../../services/voice/voice-routing-world');
const { primaryIntent } = require('../../services/conversation/intent-detector');
const { UserIntent } = require('../../services/conversation/conversation-mode-types');
const { resolveConversationMode } = require('../../services/conversation/conversation-mode-resolver');
const { canEnterClinicalLane, guardClinicalRoute } = require('../../services/kelly/rails/enter-clinical-lane');
const { KELLY_LANE } = require('../../services/kelly/rails/state-schema');
const { isToolAllowedForMode } = require('../../services/conversation/mode-tool-firewall');
const {
  isVoicemailOrIvrUtterance,
  isOptOutUtterance
} = require('../../services/conversation/rails/operator-outbound-rail');

let ok = true;
function pass(msg) {
  console.log(`✅ ${msg}`);
}
function fail(msg) {
  console.error(`❌ ${msg}`);
  ok = false;
}

function assert(cond, msg) {
  if (cond) pass(msg);
  else fail(msg);
}

// call_de149e6 / call_affe468 replay utterances (I-7 / V-1 / V-2)
const REPLAY_TURNS = [
  { id: 'de149e6', text: 'Jeremiah', expectNot: UserIntent.SYMPTOM },
  { id: 'de149e6', text: 'jeremiah at gmail dot com', expectNot: UserIntent.SYMPTOM },
  { id: 'de149e6', text: 'Can I make a booking?', expect: UserIntent.BOOK },
  { id: 'affe468', text: 'Can I make a booking?', expect: UserIntent.BOOK }
];

console.log('=== voice-routing-matrix-smoke ===\n');

assert(
  resolveRoutingWorld({ to_number: '+13639990205', direction: 'inbound' }) === 'demo',
  'platform line → demo world'
);
assert(isTenantResolvedForMode(null) === false, 'no customer_id → tenant unresolved');
assert(shouldBlockKellyTurn('unidentified') === true, 'unidentified blocks Kelly');
assert(shouldBlockKellyTurn('tenant') === false, 'tenant allows Kelly');

for (const t of REPLAY_TURNS) {
  const pi = primaryIntent(t.text);
  if (t.expect) assert(pi.intent === t.expect, `${t.id}: "${t.text}" → ${t.expect}`);
  if (t.expectNot) assert(pi.intent !== t.expectNot, `${t.id}: "${t.text}" not ${t.expectNot}`);
}

assert(
  !canEnterClinicalLane({ message: 'Can I make a booking?' }),
  'booking cannot enter clinical lane'
);
const guarded = guardClinicalRoute(
  { lane: KELLY_LANE.CLINICAL, step: 'clinical_intake' },
  { message: 'Can I make a booking?' }
);
assert(guarded.lane === KELLY_LANE.BOOKING, 'guardClinicalRoute → booking');

const unresolvedMode = resolveConversationMode({
  call_type: 'inbound_tenant',
  direction: 'inbound',
  tenantResolved: false,
  firstUtterance: 'I have a rash'
});
assert(unresolvedMode.fail_closed === true, 'unresolved tenant fail-closed at seed');

const platformSupport = resolveConversationMode({
  call_type: 'inbound_tenant',
  direction: 'inbound',
  tenantResolved: true,
  routing_world: 'platform_support',
  firstUtterance: 'I need help'
});
assert(platformSupport.reason === 'platform_support_inbound', 'platform_support mode seed');

assert(
  !isToolAllowedForMode('store_triage_opqrst', {
    routing_world: 'unidentified',
    conversation_mode: 'tenant_inbound_admin',
    active_subrail: 'handoff',
    fail_closed: true
  }),
  'CR-052+: unidentified blocks OPQRST tool'
);

assert(isVoicemailOrIvrUtterance('please leave a message after the tone'), 'O-2 voicemail detect');
assert(isOptOutUtterance("don't call me again"), 'LX-6 opt-out detect');

const { resolveCallSiteContext, SiteContextStatus } = require('../../services/voice/call-site-context');
const demoCtx = resolveCallSiteContext({
  to_number: '+13639990205',
  call_type: 'inbound_tenant',
  direction: 'inbound'
});
assert(demoCtx.site_context_status === SiteContextStatus.NOT_REQUIRED, 'SITE-02 demo → not_required');

assert(
  !isToolAllowedForMode('schedule_appointment', {
    site_context_status: 'missing',
    conversation_mode: 'tenant_inbound_admin',
    active_subrail: 'booking'
  }),
  'SITE-05: booking blocked when site missing'
);
assert(
  isToolAllowedForMode('schedule_appointment', {
    site_context_status: 'verified',
    conversation_mode: 'tenant_inbound_admin',
    active_subrail: 'booking'
  }),
  'SITE-05: booking allowed when site verified'
);

const operatorOutbound = resolveCallSiteContext({
  call_type: 'operator_outbound',
  direction: 'outbound'
});
assert(operatorOutbound.site_context_status === SiteContextStatus.NOT_REQUIRED, 'T-012: operator_outbound not_required');

const tenantOutboundMissing = resolveCallSiteContext({
  call_type: 'outbound',
  direction: 'outbound',
  customer_id: 'cust-x'
});
assert(tenantOutboundMissing.site_context_status === SiteContextStatus.MISSING, 'T-012: tenant outbound missing clinic blocked');
assert(
  !isToolAllowedForMode('schedule_appointment', {
    site_context_status: 'missing',
    conversation_mode: 'tenant_inbound_admin',
    active_subrail: 'booking',
    direction: 'outbound',
    call_type: 'outbound'
  }),
  'T-012: outbound booking blocked without clinic'
);

if (!ok) {
  console.error('\nFAILED');
  process.exit(1);
}
console.log('\n✅ voice-routing-matrix-smoke passed');
