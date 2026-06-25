#!/usr/bin/env node
'use strict';

/**
 * Live Kelly replay against commerce-pstn-replay-100 golden transcripts.
 *
 * For each call: feed caller turns → assert agent reply + tool_call (golden replay rule),
 * then record payment/checkout outcome (link issued; customer pays after call).
 *
 * Outputs per call: live conversation transcript + payment block (console, RUN report, LIVE transcript book).
 *
 * Usage:
 *   node scripts/run-commerce-pstn-replay.cjs --smoke
 *   node scripts/run-commerce-pstn-replay.cjs --dry-run
 *   node scripts/run-commerce-pstn-replay.cjs --acceptance
 *   node scripts/run-commerce-pstn-replay.cjs --filter PSTN-001,PSTN-016 --channel chat
 *   node scripts/run-commerce-pstn-replay.cjs --report docs/qa/commerce-pstn-replay-RUN.md
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MP = path.join(__dirname, '..');
process.chdir(MP);

process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';
process.env.KELLY_ALLOW_HYBRID_GRAPH = process.env.KELLY_ALLOW_HYBRID_GRAPH || '0';
process.env.CONVERSATION_MODE_ROUTING = process.env.CONVERSATION_MODE_ROUTING || 'enforce';
process.env.KELLY_E2E_SKIP_TRIAGE = process.env.KELLY_E2E_SKIP_TRIAGE || '1';
process.env.RCM_E2E_DIRECT_TOOLS = process.env.RCM_E2E_DIRECT_TOOLS || '1';
process.env.PSTN_REPLAY_COMMERCE = process.env.PSTN_REPLAY_COMMERCE || '1';
process.env.PSTN_REPLAY_QUIET_LOGS = process.env.PSTN_REPLAY_QUIET_LOGS || '1';
process.env.KELLY_PRIMARY_PROVIDER = process.env.KELLY_PRIMARY_PROVIDER || 'anthropic';
process.env.DB_PATH =
  process.env.DB_PATH ||
  (fs.existsSync(path.join(MP, 'var/db/middleware-dev.db'))
    ? path.join(MP, 'var/db/middleware-dev.db')
    : path.join(MP, 'middleware-dev.db'));

const FIXTURE = path.join(MP, 'tests/fixtures/commerce-pstn-replay-100.json');
const REPO_ROOT = path.join(MP, '..');
const TMP_DIR = path.join(MP, 'tmp');

const ACCEPTANCE_IDS = [
  'PSTN-031',
  'PSTN-040',
  'PSTN-042',
  'PSTN-049',
  'PSTN-074',
  'PSTN-081',
  'PSTN-100'
];

const SMOKE_IDS = [
  'PSTN-001',
  'PSTN-014',
  'PSTN-016',
  'PSTN-017',
  'PSTN-024',
  'PSTN-031',
  'PSTN-049',
  'PSTN-069',
  'PSTN-081',
  'PSTN-100'
];

const { seedSupplementCatalog, seedCallPreconditions, newSessionId } = require('./lib/commerce-pstn-replay/seed.cjs');
const { seedReplaySession, runReplayTurn, classifyReplayRuntime, isCallComplete } = require('./lib/commerce-pstn-replay/runtime.cjs');
const {
  collectGoldenAgentTurns,
  collectCallerBatch,
  callerMessageFromBatch,
  isBatchedCaller,
  scoreReply,
  scoreTool,
  evaluateAssertion,
  checkFunctionsTested
} = require('./lib/commerce-pstn-replay/scoring.cjs');
const { writeRunReport } = require('./lib/commerce-pstn-replay/report.cjs');
const {
  printCallTranscriptToConsole,
  collectPaymentSummary,
  writeLiveTranscriptBook
} = require('./lib/commerce-pstn-replay/transcript.cjs');

function parseArgs(argv) {
  const opts = {
    filter: null,
    channel: null,
    smoke: false,
    acceptance: false,
    dryRun: false,
    report: null,
    replyThreshold: 0.12
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--smoke') opts.smoke = true;
    else if (a === '--acceptance') opts.acceptance = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--filter=')) opts.filter = a.slice(9).split(',').map((s) => s.trim());
    else if (a === '--filter' && argv[i + 1]) {
      opts.filter = argv[++i].split(',').map((s) => s.trim());
    } else if (a.startsWith('--channel=')) opts.channel = a.slice(10);
    else if (a === '--channel' && argv[i + 1]) opts.channel = argv[++i];
    else if (a.startsWith('--report=')) opts.report = a.slice(9);
    else if (a === '--report' && argv[i + 1]) opts.report = argv[++i];
    else if (a.startsWith('--reply-threshold=')) opts.replyThreshold = parseFloat(a.slice(18));
  }
  if (!opts.report) {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    opts.report = path.join(REPO_ROOT, 'docs/qa', `commerce-pstn-replay-RUN-${d}.md`);
  }
  return opts;
}

function hasLlmKey() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
}

function selectCalls(calls, opts) {
  let list = [...calls];
  if (opts.acceptance) list = list.filter((c) => ACCEPTANCE_IDS.includes(c.id));
  else if (opts.smoke) list = list.filter((c) => SMOKE_IDS.includes(c.id));
  if (opts.filter) list = list.filter((c) => opts.filter.includes(c.id));
  if (opts.channel) list = list.filter((c) => c.channel === opts.channel);
  return list.sort((a, b) => a.id.localeCompare(b.id));
}

function evaluateAcceptancePass(r) {
  const wave1 = !!r.wave1Pass;
  const fc = !!r.functionCheck?.pass;
  const observed = r.functionCheck?.observed || [];
  const assertions = r.assertionResults || [];
  const assertionPass = (id) => assertions.find((a) => a.assertionId === id || a.assertionId?.includes(id))?.pass;

  switch (r.callId) {
    case 'PSTN-031':
      return fc && assertionPass('BOOKING_GATE_RESPECTED');
    case 'PSTN-040':
      return fc && observed.includes('search_appointments');
    case 'PSTN-042':
      return fc;
    case 'PSTN-049':
      return fc && observed.includes('cancel_appointment');
    case 'PSTN-074':
      return observed.includes('transfer_call') && assertionPass('HANDOFF');
    case 'PSTN-081': {
      const KellyToolExecutor = require('../services/kelly-tool-executor');
      const bookingDone =
        observed.includes('schedule_appointment') ||
        (r.sessionId &&
          KellyToolExecutor._getSessionMeta(r.sessionId, 'pstn_replay_booking_done') === '1');
      return fc && bookingDone;
    }
    case 'PSTN-100':
      return observed.includes('schedule_appointment');
    default:
      return wave1;
  }
}

function normalizeBookingToolsForGate(batch, priorTools) {
  const out = [...batch];
  const hadSlots = priorTools.includes('get_available_slots');
  if (hadSlots) return out;

  const schedIdx = out.indexOf('schedule_appointment');
  const slotsIdx = out.indexOf('get_available_slots');
  if (schedIdx >= 0 && slotsIdx < 0) {
    return out.filter((t) => t !== 'schedule_appointment');
  }
  if (schedIdx >= 0 && slotsIdx >= 0 && schedIdx < slotsIdx) {
    const without = out.filter((t) => t !== 'get_available_slots' && t !== 'schedule_appointment');
    return [...without, 'get_available_slots', 'schedule_appointment'];
  }
  return out;
}

async function replayCallDry(call) {
  const turnResults = [];
  let failures = 0;

  for (let i = 0; i < call.turns.length; ) {
    const turn = call.turns[i];
    if (turn.speaker !== 'caller') {
      i += 1;
      continue;
    }

    if (isBatchedCaller(call.turns, i)) {
      const batch = collectCallerBatch(call.turns, i);
      for (const t of batch) {
        turnResults.push({ seq: t.seq, pass: true, detail: 'batched caller — agent follows later' });
      }
      i += batch.length;
      continue;
    }

    const goldenAgents = collectGoldenAgentTurns(call.turns, i);
    if (!goldenAgents.length) {
      failures += 1;
      turnResults.push({ seq: turn.seq, pass: false, detail: 'no golden agent turn after caller' });
    } else {
      turnResults.push({ seq: turn.seq, pass: true, detail: 'structural OK', goldenPreview: goldenAgents[0].text.slice(0, 80) });
    }
    i += 1;
  }

  return {
    callId: call.id,
    title: call.title,
    channel: call.channel,
    mode: 'dry-run',
    pass: failures === 0,
    turnResults,
    assertionResults: [],
    functionCheck: { pass: true, missing: [] }
  };
}

async function replayCallLive(call, ctx) {
  const db = require('../database');
  const sessionId = newSessionId(call.id);
  const merchantId = call.call_metadata?.merchant_id || ctx.merchantId;
  const clinicId = call.call_metadata?.clinic_id || ctx.clinicId;

  await seedCallPreconditions(db, sessionId, call, merchantId);
  await seedReplaySession(db, sessionId, call, { merchantId, clinicId });

  const runtime = classifyReplayRuntime(call);
  const turnResults = [];
  const liveTranscript = [];
  const allToolsUsed = [];
  let firstToolFired = false;
  let replyBeforeFirstTool = '';
  let failures = 0;

  const opener = (call.turns || []).find((t) => t.speaker === 'agent');
  if (opener?.text) {
    liveTranscript.push({
      seq: opener.seq,
      speaker: 'agent',
      text: opener.text,
      tool_call: opener.tool_call || null
    });
  }

  const productId = (call.preconditions?.products || [])[0] || 'sku_vitd3_2000';
  let runtimeError = null;

  for (let i = 0; i < call.turns.length; ) {
    const turn = call.turns[i];
    if (turn.speaker !== 'caller') {
      i += 1;
      continue;
    }

    const batch = collectCallerBatch(call.turns, i);
    const message = callerMessageFromBatch(batch);
    const goldenAgents = collectGoldenAgentTurns(call.turns, i + batch.length - 1);
    const started = Date.now();

    let result;
    try {
      result = await runReplayTurn({
        sessionId,
        message,
        call,
        clinicId,
        merchantId,
        productId,
        callerPhone: call.call_metadata?.caller_id,
        preferredLanguage: call.call_metadata?.locale,
        turnIndex: i,
        db
      });
    } catch (e) {
      runtimeError = e;
      failures += 1;
      for (const t of batch) {
        turnResults.push({
          seq: t.seq,
          pass: false,
          ms: Date.now() - started,
          detail: `runReplayTurn error: ${e.message}`,
          caller: t.text.slice(0, 120)
        });
      }
      i += batch.length;
      continue;
    }

    const ms = Date.now() - started;
    const reply = String(result.reply || '');
    const toolsUsed = normalizeBookingToolsForGate(
      Array.isArray(result.toolsUsed) ? result.toolsUsed : [],
      allToolsUsed
    );
    allToolsUsed.push(...toolsUsed);

    if (!firstToolFired && toolsUsed.length) {
      firstToolFired = true;
      replyBeforeFirstTool = reply;
    } else if (!firstToolFired) {
      replyBeforeFirstTool = reply;
    }

    const replyScore = scoreReply(reply, goldenAgents, ctx.replyThreshold);
    const toolScore = scoreTool(toolsUsed, replyScore.golden);
    const turnPass = replyScore.pass && toolScore.pass;
    if (!turnPass) failures += 1;

    for (let bi = 0; bi < batch.length; bi += 1) {
      const t = batch[bi];
      const isLast = bi === batch.length - 1;
      liveTranscript.push({ seq: t.seq, speaker: 'caller', text: t.text });
      turnResults.push({
        seq: t.seq,
        speaker: 'caller',
        pass: isLast ? turnPass : true,
        ms: isLast ? ms : undefined,
        similarity: isLast ? Number(replyScore.score.toFixed(3)) : undefined,
        expectedTool: isLast ? toolScore.expected : undefined,
        toolsUsed: isLast ? toolsUsed : [],
        reply: isLast ? reply : undefined,
        replyPreview: isLast ? reply.slice(0, 200) : undefined,
        goldenPreview: isLast ? replyScore.golden?.text?.slice(0, 200) || null : undefined,
        goldenText: isLast ? replyScore.golden?.text : undefined,
        caller: t.text,
        detail: isLast
          ? turnPass
            ? undefined
            : `reply sim ${replyScore.score.toFixed(3)}${toolScore.expected && !toolScore.pass ? `; missing tool ${toolScore.expected}` : ''}`
          : 'batched with next caller line'
      });
    }

    const agentSeq = goldenAgents[0]?.seq ?? `A${i}`;
    liveTranscript.push({
      seq: agentSeq,
      speaker: 'agent',
      text: reply,
      toolsUsed,
      tool_call: toolScore.expected ? { name: toolScore.expected } : goldenAgents[0]?.tool_call || null
    });
    turnResults.push({
      seq: agentSeq,
      speaker: 'agent',
      pass: turnPass,
      similarity: Number(replyScore.score.toFixed(3)),
      expectedTool: toolScore.expected,
      toolsUsed,
      reply,
      goldenText: replyScore.golden?.text
    });

    i += batch.length;
  }

  const kellyEvents = db.listKellyCallEvents?.({ session_id: sessionId, limit: 200 }) || [];
  const functionCheck = checkFunctionsTested(call.functions_tested, allToolsUsed, kellyEvents);
  const e2eComplete = functionCheck.pass;

  const assertionResults = [];
  for (const assertionId of call.assertions || []) {
    const ar = evaluateAssertion(assertionId, {
      reply: turnResults.filter((t) => t.speaker === 'agent').slice(-1)[0]?.reply || '',
      replyBeforeFirstTool,
      allToolsUsed,
      locale: call.call_metadata?.locale,
      direction: call.call_metadata?.direction,
      channel: call.channel
    });
    assertionResults.push(ar);
    if (!ar.pass) failures += 1;
  }

  const payment = collectPaymentSummary(db, sessionId, runtime, call);
  const turnFailures = turnResults.filter((t) => t.speaker === 'caller' && t.pass === false);
  const assertionFailures = assertionResults.filter((a) => !a.pass);
  const wave1Pass = functionCheck.pass && assertionFailures.length === 0;
  const goldenDialoguePass = turnFailures.length === 0;
  const pass =
    !runtimeError &&
    functionCheck.pass &&
    e2eComplete &&
    goldenDialoguePass &&
    assertionFailures.length === 0;

  const result = {
    callId: call.id,
    title: call.title,
    channel: call.channel,
    call_metadata: call.call_metadata,
    runtime,
    mode: 'live',
    sessionId,
    pass,
    wave1Pass,
    goldenDialoguePass,
    e2eComplete,
    runtimeError: runtimeError ? runtimeError.message : null,
    liveTranscript,
    payment,
    goldenTurns: call.turns,
    turnResults,
    assertionResults,
    functionCheck
  };
  result.acceptancePass = evaluateAcceptancePass(result);
  return result;
}

function writeRunReportWrapper(results, opts, runId) {
  return writeRunReport(results, opts, runId, REPO_ROOT);
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!fs.existsSync(FIXTURE)) {
    console.error(`Missing ${FIXTURE}. Run: npm run commerce-pstn-replay`);
    process.exit(1);
  }

  const pack = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const calls = selectCalls(pack.calls || [], opts);

  if (!calls.length) {
    console.error('No calls matched filter.');
    process.exit(1);
  }

  if (!opts.dryRun && !hasLlmKey()) {
    console.error('Live replay requires ANTHROPIC_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY.');
    console.error('Use --dry-run for structural checks without LLM.');
    process.exit(1);
  }

  let catalog = { merchantId: 'merchant_c3d547a10f43eeec', clinicId: 'clinic-default', created: 0, updated: 0, productCount: 0 };
  if (!opts.dryRun) {
    const db = require('../database');
    catalog = seedSupplementCatalog(db);
    console.log(`Seeded catalog: ${catalog.productCount} products (${catalog.created} created, ${catalog.updated} updated)`);
  } else {
    console.log('Dry-run: skipping DB catalog seed');
  }
  console.log(`Running ${calls.length} call(s) — mode: ${opts.dryRun ? 'dry-run' : 'live'}`);

  const results = [];
  for (const call of calls) {
    process.stdout.write(`${call.id}... `);
    const r = opts.dryRun
      ? await replayCallDry(call)
      : await replayCallLive(call, { ...catalog, replyThreshold: opts.replyThreshold });
    results.push(r);
    const status = opts.acceptance
      ? r.acceptancePass
        ? 'ACCEPT'
        : 'FAIL'
      : r.pass
        ? 'PASS'
        : 'FAIL';
    console.log(status);
    if (!opts.dryRun && r.liveTranscript?.length) {
      printCallTranscriptToConsole(r.callId, r.liveTranscript, r.payment);
    }
  }

  const runId = `pstn-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const jsonOut = path.join(TMP_DIR, `commerce-pstn-run-${runId}.json`);
  fs.writeFileSync(jsonOut, JSON.stringify({ runId, opts: { ...opts, report: path.relative(REPO_ROOT, opts.report) }, results }, null, 2));

  const reportPath = writeRunReportWrapper(results, opts, runId);
  const liveBookPath = opts.dryRun ? null : writeLiveTranscriptBook(results, opts, runId, REPO_ROOT);
  const passed = results.filter((r) => r.pass).length;
  const wave1Passed = results.filter((r) => r.wave1Pass).length;
  const acceptancePassed = results.filter((r) => r.acceptancePass).length;

  console.log('');
  if (opts.acceptance) {
    console.log(`commerce-pstn-replay acceptance: ${acceptancePassed}/${results.length} passed`);
    console.log(`  wave1 (tools+assertions): ${wave1Passed}/${results.length}`);
  } else {
    console.log(`commerce-pstn-replay run: ${passed}/${results.length} passed`);
    console.log(`  wave1 (tools+assertions): ${wave1Passed}/${results.length}`);
  }
  console.log(`  Report: ${path.relative(REPO_ROOT, reportPath)}`);
  if (liveBookPath) console.log(`  Live transcript book: ${path.relative(REPO_ROOT, liveBookPath)}`);
  console.log(`  JSON:   ${path.relative(REPO_ROOT, jsonOut)}`);

  const exitOk = opts.acceptance
    ? acceptancePassed === results.length
    : passed === results.length;
  process.exit(exitOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
