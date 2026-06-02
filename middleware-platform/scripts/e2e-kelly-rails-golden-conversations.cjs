#!/usr/bin/env node
'use strict';

/**
 * Kelly Rails Phase B — golden conversation harness (deterministic paths).
 * Asserts routing + toolsUsed; does not require LLM for router-only scenarios.
 *
 * Usage:
 *   node scripts/e2e-kelly-rails-golden-conversations.cjs
 *   KELLY_GOLDEN_INCLUDE_LLM=1 node scripts/e2e-kelly-rails-golden-conversations.cjs
 */

process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
process.env.KELLY_ALLOW_HYBRID_GRAPH = process.env.KELLY_ALLOW_HYBRID_GRAPH || '0';
process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';

const path = require('path');
const fixture = require('../tests/fixtures/kelly-rails-golden-utterances.json');
const { routeOrchestratorLane, KELLY_LANE } = require('../services/kelly-rails/state-schema');
const { executeTurn } = require('../services/kelly-rails/execute-turn');

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}

function fail(name, detail) {
  failed++;
  console.error(`  ❌ ${name}: ${detail}`);
}

function assert(cond, name, detail) {
  if (cond) ok(name);
  else fail(name, detail);
}

async function runRouterGolden() {
  console.log('\n==> Router golden utterances (fixture)');
  for (const row of fixture.cases) {
    const r = routeOrchestratorLane({
      last_user_message: row.last_user_message,
      flags: row.flags || {}
    });
    const laneOk = r.lane === row.expect.lane;
    const stepOk = r.step === row.expect.step;
    const safetyOk = row.expect.safety_blocked ? r.safety_blocked === true : true;
    assert(
      laneOk && stepOk && safetyOk,
      row.id,
      `got lane=${r.lane} step=${r.step} safety=${r.safety_blocked}`
    );
  }
}

async function runDeterministicConversations() {
  console.log('\n==> Deterministic conversations');

  const r1 = routeOrchestratorLane({
    last_user_message: 'I need a receipt for my last appointment',
    flags: {}
  });
  assert(r1.lane === KELLY_LANE.SUPPORT, 'conv9_receipt_support', `lane=${r1.lane}`);

  const r2 = routeOrchestratorLane({
    last_user_message: 'What did my doctor say on my last visit',
    flags: {}
  });
  assert(r2.lane === KELLY_LANE.ACCOUNT, 'conv10_records_account', `lane=${r2.lane}`);

  const { state: s3, reply: rep3, endCall } = await executeTurn({
    sessionId: 'golden-safety-1',
    message: "I'm having chest pain",
    v2_hydrated: true
  });
  assert(s3.flags.safety_blocked && /911|emergency/i.test(rep3), 'conv_safety_emergency', rep3);
  assert(endCall === true, 'conv_safety_end_call', String(endCall));

  const KellyToolExecutor = require('../services/kelly-tool-executor');
  KellyToolExecutor._setSessionMeta('golden-pp-1', 'last_appointment_id', 'appt-g1');
  KellyToolExecutor._setSessionMeta('golden-pp-1', 'last_slot_date', '2026-06-15');
  KellyToolExecutor._setSessionMeta('golden-pp-1', 'last_slot_time', '14:00');

  const { state: s5, reply: rep5 } = await executeTurn({
    sessionId: 'golden-pp-1',
    message: 'What happens next after I book?',
    flags: {
      appointment_id: 'appt-g1',
      post_visit_confirmation_pending: true
    },
    v2_hydrated: true
  });
  assert(
    s5.active_lane === KELLY_LANE.POST_PAYMENT && /confirmed|appointment/i.test(rep5),
    'conv5_post_visit_confirm',
    `lane=${s5.active_lane} reply=${rep5?.slice(0, 80)}`
  );

  const { state: s6, reply: rep6 } = await executeTurn({
    sessionId: 'golden-pp-2',
    message: 'I just paid, what do I do now?',
    flags: {
      appointment_id: 'appt-g2',
      payment_complete: true
    },
    v2_hydrated: true
  });
  assert(
    s6.active_lane === KELLY_LANE.POST_PAYMENT && /confirmed|appointment/i.test(rep6),
    'conv6_post_pay_confirm',
    `lane=${s6.active_lane}`
  );

  const r7 = routeOrchestratorLane({
    last_user_message: 'What moisturizer should I use for dry skin?',
    flags: { routine_intake_active: true }
  });
  assert(r7.lane === KELLY_LANE.EDUCATION, 'conv7_education_stay', `lane=${r7.lane}`);

  const { state: s8 } = await executeTurn({
    sessionId: 'golden-escape-1',
    message: 'I have an itchy rash and need a dermatology appointment',
    active_lane: KELLY_LANE.EDUCATION,
    step: 'education',
    flags: { routine_intake_active: true },
    v2_hydrated: true
  });
  assert(
    [KELLY_LANE.CLINICAL, KELLY_LANE.BOOKING].includes(s8.active_lane),
    'conv8_education_escape',
    `lane=${s8.active_lane}`
  );

  const rPayBeforeBook = routeOrchestratorLane({
    last_user_message: 'I want to pay my copay now',
    flags: { appointment_id: null, copay_amount: 25 }
  });
  assert(rPayBeforeBook.lane === KELLY_LANE.PAYMENT, 'conv4_pay_intent_routes_payment', `lane=${rPayBeforeBook.lane}`);
}

async function runLlmPlaceholder() {
  if (process.env.KELLY_GOLDEN_INCLUDE_LLM !== '1') {
    console.log('\n==> LLM conversations 1–4 (skipped in CI — covered by F2 gate)');
    console.log('    Production proof: npm run test:e2e:rcm:conversation --prefix middleware-platform');
    console.log('    With KELLY_RAILS_V2=1 KELLY_ALLOW_HYBRID_GRAPH=0 RCM_E2E_USE_EXISTING_SERVER=1');
    return;
  }
  console.log('\n==> LLM golden convos 1–4: use F2 as authoritative gate (visit + payment + provider clinical-prep)');
  console.log('    npm run test:e2e:rcm:conversation --prefix middleware-platform');
  if (process.env.RCM_E2E_USE_EXISTING_SERVER !== '1') {
    console.warn('    Set RCM_E2E_USE_EXISTING_SERVER=1 and start middleware on :4000 for full LLM proof.');
  }
}

async function main() {
  console.log('Kelly Rails golden conversations (Phase B)');
  await runRouterGolden();
  await runDeterministicConversations();
  await runLlmPlaceholder();

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('Golden conversation harness OK (deterministic paths).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
