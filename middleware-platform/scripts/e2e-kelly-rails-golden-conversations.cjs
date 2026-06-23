#!/usr/bin/env node
'use strict';

/**
 * Kelly Rails Phase B — 10 golden conversations (2 per rail) + guardrail checks.
 *
 * Usage:
 *   npm run test:e2e:kelly:golden-conversations --prefix middleware-platform
 *   KELLY_GOLDEN_INCLUDE_LLM=1 ...  # defers visit/payment LLM depth to F2 (see runLlmGateNote)
 */

process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
process.env.KELLY_ALLOW_HYBRID_GRAPH = process.env.KELLY_ALLOW_HYBRID_GRAPH || '0';
process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';
if (process.env.KELLY_GOLDEN_LOCALE === 'es') {
  process.env.KELLY_RAILS_ES_ENABLED = '1';
}

/** Stub payment tool in harness so copay conv does not depend on Stripe/network. */
function installGoldenPaymentStub() {
  const KellyToolExecutor = require('../services/kelly/kelly-tool-executor');
  if (KellyToolExecutor.__goldenPaymentStubbed) return;
  const orig = KellyToolExecutor.execute.bind(KellyToolExecutor);
  KellyToolExecutor.execute = async function goldenExecute(name, args, ctx) {
    if (name === 'request_patient_payment') {
      return {
        success: true,
        pay_url: 'https://pay.golden.test/link',
        pay_token: 'tok-golden-e2e',
        message: 'Secure payment link sent.'
      };
    }
    return orig(name, args, ctx);
  };
  KellyToolExecutor.__goldenPaymentStubbed = true;
}
installGoldenPaymentStub();

const golden =
  process.env.KELLY_GOLDEN_LOCALE === 'es'
    ? require('../tests/fixtures/kelly-rails-golden-conversations-es.json')
    : require('../tests/fixtures/kelly-rails-golden-conversations.json');
const { routeOrchestratorLane, KELLY_LANE } = require('../services/kelly/rails/state-schema');
const { executeTurn } = require('../services/kelly/rails/execute-turn');
const { getAllowedToolNames } = require('../services/kelly/rails/tool-allowlists');

let passed = 0;
let failed = 0;
const byRail = {};

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

function trackRail(rail, success) {
  if (!byRail[rail]) byRail[rail] = { pass: 0, fail: 0 };
  if (success) byRail[rail].pass++;
  else byRail[rail].fail++;
}

function checkToolGuardrails(toolsUsed, expect, convId, reply) {
  const used = Array.isArray(toolsUsed) ? toolsUsed : [];
  let okAll = true;
  const required = expect.toolsRequired || [];
  const requiredAny = expect.toolsRequiredAny || [];
  if (requiredAny.length) {
    const hasTool = requiredAny.some((t) => used.includes(t));
    const hasReply =
      expect.replyMatches && new RegExp(expect.replyMatches, 'i').test(String(reply || ''));
    if (!hasTool && !hasReply) {
      fail(
        `${convId}_guard_required_any`,
        `need one of [${requiredAny.join(',')}] or reply /${expect.replyMatches}/; tools=${used.join(',')}`
      );
      okAll = false;
    }
  }
  for (const t of required) {
    if (!used.includes(t)) {
      fail(`${convId}_guard_required_${t}`, `missing required tool ${t}; got ${used.join(',')}`);
      okAll = false;
    }
  }
  for (const t of expect.toolsForbidden || []) {
    if (used.includes(t)) {
      fail(`${convId}_guard_forbidden_${t}`, `forbidden tool ${t} was used`);
      okAll = false;
    }
  }
  if (
    okAll &&
    (required.length ||
      requiredAny.length ||
      (expect.toolsForbidden || []).length)
  ) {
    ok(`${convId}_tool_guardrails`);
  }
  return okAll;
}

function checkAllowListGuardrail(lane, step, toolsUsed, convId) {
  const allowed = new Set(getAllowedToolNames(lane, step));
  if (lane === KELLY_LANE.PAYMENT && step === 'insurance') {
    for (const t of getAllowedToolNames(KELLY_LANE.PAYMENT, 'pay_invoice')) {
      allowed.add(t);
    }
  }
  const used = Array.isArray(toolsUsed) ? toolsUsed : [];
  let okAll = true;
  for (const t of used) {
    if (!allowed.has(t)) {
      fail(`${convId}_allowlist_${t}`, `tool ${t} not in allow-list for ${lane}/${step}`);
      okAll = false;
    }
  }
  if (okAll && used.length) ok(`${convId}_allowlist_ok`);
  return okAll;
}

async function runConversation(conv) {
  const exp = conv.expect || {};
  let convOk = true;

  if (conv.mode === 'router') {
    const r = routeOrchestratorLane({
      last_user_message: conv.message,
      flags: conv.flags || {}
    });
    if (exp.lane && r.lane !== exp.lane) {
      fail(conv.id, `lane=${r.lane} expected ${exp.lane}`);
      convOk = false;
    }
    if (exp.step && r.step !== exp.step) {
      fail(conv.id, `step=${r.step} expected ${exp.step}`);
      convOk = false;
    }
    if (exp.safety_blocked && !r.safety_blocked) {
      fail(conv.id, 'expected safety_blocked');
      convOk = false;
    }
    if (convOk) ok(conv.id);
    checkToolGuardrails([], exp, conv.id, null);
    trackRail(conv.rail, convOk);
    return;
  }

  const sessionId = `golden-${conv.id}`;
  const KellyToolExecutor = require('../services/kelly/kelly-tool-executor');
  if (conv.sessionMeta) {
    for (const [k, v] of Object.entries(conv.sessionMeta)) {
      KellyToolExecutor._setSessionMeta(sessionId, k, v);
    }
  }

  const input = {
    sessionId,
    message: conv.message,
    flags: conv.flags || {},
    v2_hydrated: true,
    clinicId: conv.clinicId || 'clinic-golden-e2e',
    patientId: conv.patientId || 'patient-golden-e2e',
    locale: conv.locale || (process.env.KELLY_GOLDEN_LOCALE === 'es' ? 'es' : 'en')
  };
  if (conv.active_lane) input.active_lane = conv.active_lane;
  if (conv.step) input.step = conv.step;

  const { state, reply, toolsUsed, endCall } = await executeTurn(input);
  const lane = state.active_lane;
  const step = state.step;

  if (exp.lane && lane !== exp.lane) {
    fail(conv.id, `lane=${lane} expected ${exp.lane}`);
    convOk = false;
  }
  if (exp.laneIn && !exp.laneIn.includes(lane)) {
    fail(conv.id, `lane=${lane} expected one of ${exp.laneIn.join(',')}`);
    convOk = false;
  }
  if (exp.step && step !== exp.step) {
    fail(conv.id, `step=${step} expected ${exp.step}`);
    convOk = false;
  }
  if (exp.safety_blocked && !state.flags.safety_blocked) {
    fail(conv.id, 'expected safety_blocked flag');
    convOk = false;
  }
  if (exp.endCall && !endCall) {
    fail(conv.id, 'expected endCall');
    convOk = false;
  }
  if (exp.replyMatches && !new RegExp(exp.replyMatches, 'i').test(String(reply || ''))) {
    fail(conv.id, `reply did not match /${exp.replyMatches}/`);
    convOk = false;
  }
  if (convOk) ok(conv.id);

  const guardOk = checkToolGuardrails(toolsUsed, exp, conv.id, reply);
  if (lane && step && toolsUsed?.length) {
    checkAllowListGuardrail(lane, step, toolsUsed, conv.id);
  }
  trackRail(conv.rail, convOk && guardOk);
}

function printRailSummary() {
  console.log('\n==> Per-rail summary (expect 2 pass each)');
  let railGateFail = false;
  for (const rail of golden.rails) {
    const s = byRail[rail] || { pass: 0, fail: 0 };
    const status = s.pass >= 2 && s.fail === 0 ? 'OK' : 'FAIL';
    console.log(`  ${rail}: ${s.pass}/2 passed (${status})`);
    if (s.pass < 2 || s.fail > 0) railGateFail = true;
  }
  if (railGateFail) failed++;
}

function runLlmGateNote() {
  if (process.env.KELLY_GOLDEN_INCLUDE_LLM === '1') {
    console.log('\n==> LLM depth (visit/payment multi-turn): run F2');
    console.log('    KELLY_RAILS_V2=1 RCM_E2E_USE_EXISTING_SERVER=1 npm run test:e2e:rcm:conversation');
  }
}

async function main() {
  const isEs = process.env.KELLY_GOLDEN_LOCALE === 'es';
  const convs = golden.conversations || [];
  console.log(
    isEs
      ? `Kelly Rails — ES golden conversations (${convs.length})`
      : 'Kelly Rails — 10 golden conversations (2 per rail)'
  );
  if (!isEs && convs.length !== 10) {
    console.error(`Expected 10 conversations, got ${convs.length}`);
    process.exit(1);
  }
  if (isEs && convs.length < 1) {
    console.error('ES golden fixture has no conversations');
    process.exit(1);
  }

  console.log('\n==> Golden conversations');
  for (const conv of convs) {
    await runConversation(conv);
  }

  if (!isEs) printRailSummary();
  runLlmGateNote();

  console.log(`\nSummary: ${passed} assertions passed, ${failed} failures`);
  if (failed > 0) process.exit(1);
  console.log(
    isEs
      ? `Gate OK: ${convs.length} ES golden conversation(s), guardrails verified.`
      : 'Gate OK: 10 golden conversations (2 per rail), guardrails verified.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
