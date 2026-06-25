'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MP = path.join(__dirname, '../../..');
const REPO_ROOT = path.join(MP, '..');
const FIXTURE = path.join(MP, 'tests/fixtures/commerce-pstn-replay-100.json');
const COVERAGE_JSON = path.join(MP, 'tests/fixtures/commerce-pstn-function-coverage.json');
const SCHEMA_JSON = path.join(MP, 'tests/fixtures/commerce-pstn-replay-schema.json');
const TRANSCRIPT_BOOK = path.join(REPO_ROOT, 'docs/qa/commerce-pstn-replay-100-TRANSCRIPT_BOOK.md');
const REPORT_OUT = path.join(REPO_ROOT, 'docs/qa/commerce-pstn-replay-100-VALIDATION_REPORT.md');

const REQUIRED_FUNCTIONS = {
  collect_insurance: 3,
  get_available_slots: 4,
  schedule_appointment: 6,
  patient_intake: 2,
  get_patient_intake_status: 1,
  search_appointments: 2,
  confirm_appointment: 2,
  cancel_appointment: 4,
  reschedule_appointment: 3,
  send_document_upload_link: 1,
  create_appointment_checkout: 4,
  verify_checkout_code: 3,
  request_patient_payment: 2,
  get_patient_claims: 1,
  store_triage_opqrst: 2,
  run_triage_rag: 2,
  get_triage_session: 1,
  search_products: 8,
  create_checkout: 8,
  get_order_tracking: 2,
  get_available_payment_methods: 2,
  get_product_quote: 4,
  add_to_cart: 4,
  get_cart: 3,
  update_cart_item: 2,
  remove_cart_item: 2,
  clear_cart: 2,
  save_shipping_address: 2,
  send_commerce_verification_code: 2,
  verify_commerce_code: 2,
  prepare_commerce_checkout: 5,
  get_checkout_payment_status: 2,
  transfer_call: 4,
  end_call: 100
};

const BLOCKS = [
  { title: 'Block 1: Voice supplement purchase', start: 1, end: 15 },
  { title: 'Block 2: Chat supplement purchase', start: 16, end: 30 },
  { title: 'Block 3: Voice appointment booking', start: 31, end: 48 },
  { title: 'Block 4: Cancel / reschedule / outbound', start: 49, end: 60 },
  { title: 'Block 5: Appointment payments', start: 61, end: 68 },
  { title: 'Block 6: Complaints / vent / handoff', start: 69, end: 80 },
  { title: 'Block 7: Multi-intent / edge / capstone', start: 81, end: 100 }
];

const BRACKET_RE = /\[[^\]]+\]/;

function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (_) {
    return 'unknown';
  }
}

function rel(p) {
  return path.relative(REPO_ROOT, p);
}

function validatePack(pack) {
  const calls = pack.calls || pack.scenarios || [];
  const errors = [];
  const fnCounts = {};
  let bracketCount = 0;
  let emptyTextCount = 0;

  if (calls.length !== 100) errors.push(`Expected 100 calls, found ${calls.length}`);

  const voice = calls.filter((c) => c.channel === 'voice').length;
  const chat = calls.filter((c) => c.channel === 'chat').length;
  if (voice !== 81) errors.push(`Expected 81 voice calls, found ${voice}`);
  if (chat !== 19) errors.push(`Expected 19 chat calls, found ${chat}`);

  for (const call of calls) {
    const minRequired = call.channel === 'chat' ? 14 : 12;
    const turnCount = (call.turns || []).length;

    if (turnCount < minRequired) {
      errors.push(`${call.id}: ${turnCount} turns, need ${minRequired}`);
    }

    if (!call.functions_tested?.includes('end_call')) {
      errors.push(`${call.id}: missing end_call in functions_tested`);
    }

    const lastAgentWithEnd = (call.turns || []).some(
      (t) => t.speaker === 'agent' && t.tool_call?.name === 'end_call'
    );
    if (!lastAgentWithEnd) {
      errors.push(`${call.id}: no agent turn with end_call tool`);
    }

    for (const turn of call.turns || []) {
      if (!turn.text || !String(turn.text).trim()) {
        emptyTextCount += 1;
        errors.push(`${call.id} turn ${turn.seq}: empty text`);
      }
      if (turn.speaker === 'caller' && BRACKET_RE.test(turn.text)) {
        bracketCount += 1;
        errors.push(`${call.id} turn ${turn.seq}: bracket placeholder in caller text`);
      }
    }

    for (const fn of call.functions_tested || []) {
      fnCounts[fn] = (fnCounts[fn] || 0) + 1;
    }
  }

  const fnGaps = [];
  for (const [fn, min] of Object.entries(REQUIRED_FUNCTIONS)) {
    const count = fnCounts[fn] || 0;
    if (count < min) {
      fnGaps.push({ fn, count, min });
      errors.push(`Function ${fn}: ${count} calls, need ${min}`);
    }
  }

  const coverageOk = fs.existsSync(COVERAGE_JSON);
  const bookOk = fs.existsSync(TRANSCRIPT_BOOK);
  const schemaOk = fs.existsSync(SCHEMA_JSON);

  const acceptance = {
    hundred_entries: calls.length === 100,
    min_turns: !errors.some((e) => e.includes('turns, need')),
    every_turn_text: emptyTextCount === 0,
    zero_brackets: bracketCount === 0,
    functions_covered: fnGaps.length === 0,
    coverage_json: coverageOk,
    transcript_book: bookOk
  };

  return {
    ok: errors.length === 0,
    errors,
    calls,
    voice,
    chat,
    fnCounts,
    fnGaps,
    bracketCount,
    acceptance,
    coverageOk,
    bookOk,
    schemaOk,
    generatedAt: pack.generated_at || new Date().toISOString()
  };
}

function blockSummary(calls, start, end) {
  const ids = [];
  for (let n = start; n <= end; n += 1) ids.push(`PSTN-${String(n).padStart(3, '0')}`);
  const blockCalls = calls.filter((c) => ids.includes(c.id));
  const turns = blockCalls.reduce((s, c) => s + (c.turns || []).length, 0);
  const avg = blockCalls.length ? (turns / blockCalls.length).toFixed(1) : '0';
  const v = blockCalls.filter((c) => c.channel === 'voice').length;
  const ch = blockCalls.filter((c) => c.channel === 'chat').length;
  return { count: blockCalls.length, avgTurns: avg, voice: v, chat: ch };
}

function writeValidationReport(result) {
  const ts = new Date().toISOString();
  const lines = [
    '# Commerce PSTN Replay 100 — Validation Report',
    '',
    `**Generated:** ${ts}`,
    `**Fixture version:** ${result.generatedAt}`,
    `**Git SHA:** ${gitSha()}`,
    '',
    `**Status:** ${result.ok ? 'PASS' : 'FAIL'}`,
    '',
    '---',
    '',
    '## Acceptance criteria (plan)',
    '',
    '| Criterion | Status |',
    '|-----------|--------|',
    `| 100 entries in commerce-pstn-replay-100.json | ${result.acceptance.hundred_entries ? 'PASS' : 'FAIL'} |`,
    `| Min turns (voice ≥12, chat ≥14) | ${result.acceptance.min_turns ? 'PASS' : 'FAIL'} |`,
    `| Every turn has text for both speakers | ${result.acceptance.every_turn_text ? 'PASS' : 'FAIL'} |`,
    `| Zero bracket placeholders in caller text | ${result.acceptance.zero_brackets ? 'PASS' : 'FAIL'} (${result.bracketCount} found) |`,
    `| All 34 functions meet minimum call counts | ${result.acceptance.functions_covered ? 'PASS' : 'FAIL'} |`,
    `| commerce-pstn-function-coverage.json present | ${result.acceptance.coverage_json ? 'PASS' : 'FAIL'} |`,
    `| TRANSCRIPT_BOOK.md generated | ${result.acceptance.transcript_book ? 'PASS' : 'FAIL'} |`,
    '',
    '---',
    '',
    '## Channel split',
    '',
    '| Channel | Count | Plan overview note |',
    '|---------|-------|-------------------|',
    `| voice | ${result.voice} | Plan overview said 85; block tables sum to 81 |`,
    `| chat | ${result.chat} | Plan overview said 15; block tables sum to 19 |`,
    `| **total** | **${result.calls.length}** | |`,
    '',
    '---',
    '',
    '## Per-block summary',
    '',
    '| Block | Calls | Voice | Chat | Avg turns |',
    '|-------|-------|-------|------|-----------|'
  ];

  for (const b of BLOCKS) {
    const s = blockSummary(result.calls, b.start, b.end);
    lines.push(`| ${b.title} | ${s.count} | ${s.voice} | ${s.chat} | ${s.avgTurns} |`);
  }

  lines.push('', '---', '', '## Function coverage', '', '| Function | Actual | Required | Status |', '|----------|--------|----------|--------|');

  for (const [fn, min] of Object.entries(REQUIRED_FUNCTIONS).sort()) {
    const count = result.fnCounts[fn] || 0;
    const status = count >= min ? 'OK' : 'GAP';
    lines.push(`| \`${fn}\` | ${count} | ${min} | ${status} |`);
  }

  lines.push('', '---', '', '## Artifact paths', '', '| Artifact | Path |', '|----------|------|');
  lines.push(`| Replay pack | \`${rel(FIXTURE)}\` |`);
  lines.push(`| Function coverage | \`${rel(COVERAGE_JSON)}\` |`);
  lines.push(`| Call schema | \`${rel(SCHEMA_JSON)}\` |`);
  lines.push(`| Transcript book | \`${rel(TRANSCRIPT_BOOK)}\` |`);
  lines.push(`| This report | \`${rel(REPORT_OUT)}\` |`);

  if (result.errors.length) {
    lines.push('', '---', '', '## Errors', '');
    for (const e of result.errors) lines.push(`- ${e}`);
  }

  lines.push('');
  fs.mkdirSync(path.dirname(REPORT_OUT), { recursive: true });
  fs.writeFileSync(REPORT_OUT, lines.join('\n'));
  return REPORT_OUT;
}

function printSuccessSummary(reportPath) {
  console.log('commerce-pstn-replay: OK');
  console.log(`  Fixtures: ${rel(FIXTURE)}`);
  console.log(`  Coverage: ${rel(COVERAGE_JSON)}`);
  console.log(`  Transcript book: ${rel(TRANSCRIPT_BOOK)}`);
  console.log(`  Validation report: ${rel(reportPath)}`);
}

function printValidateOnly(result) {
  console.log('validate-commerce-pstn-replay: OK');
  console.log(`  100 calls (${result.voice} voice, ${result.chat} chat)`);
  console.log(`  ${Object.keys(result.fnCounts).length} functions covered`);
}

function fail(errors) {
  console.error('validate-commerce-pstn-replay: FAILED');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

module.exports = {
  FIXTURE,
  REPORT_OUT,
  TRANSCRIPT_BOOK,
  COVERAGE_JSON,
  REQUIRED_FUNCTIONS,
  validatePack,
  writeValidationReport,
  printSuccessSummary,
  printValidateOnly,
  fail
};
