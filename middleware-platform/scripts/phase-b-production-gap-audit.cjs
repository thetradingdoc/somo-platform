#!/usr/bin/env node
'use strict';

/**
 * Phase B production-readiness gap audit — emits NDJSON to debug ingest + stdout report.
 * Run: node scripts/phase-b-production-gap-audit.cjs
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const mpRoot = path.join(__dirname, '..');

function dbg(_hypothesisId, _location, _message, _data = {}) {
  if (process.env.DEBUG_GAP_AUDIT !== '1') return;
  const DEBUG_ENDPOINT = 'http://127.0.0.1:7741/ingest/60c91aef-af1c-44d6-9853-4dc7e0e1d879';
  fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '01ab01' },
    body: JSON.stringify({
      sessionId: '01ab01',
      runId: process.env.DEBUG_RUN_ID || 'gap-audit',
      hypothesisId: _hypothesisId,
      location: _location,
      message: _message,
      data: _data,
      timestamp: Date.now()
    })
  }).catch(() => {});
}

const gaps = [];

function gap(id, severity, item, evidence) {
  gaps.push({ id, severity, item, evidence });
  dbg('GAP', `phase-b-production-gap-audit.cjs:${id}`, item, { severity, evidence });
}

function fileExists(rel) {
  return fs.existsSync(path.join(mpRoot, rel));
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd: mpRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 120000
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

async function main() {
  console.log('=== Kelly Rails Phase B — production gap audit ===\n');

  // H1: CI wiring
  const ciYml = fs.readFileSync(path.join(mpRoot, '..', '.github/workflows/ci.yml'), 'utf8');
  const ciHasGolden = /test:kelly:rails:golden/.test(ciYml);
  dbg('H1', 'audit:ci', 'CI kelly golden check', { ciHasGolden });
  if (!ciHasGolden) {
    gap(
      'G01',
      'high',
      'Golden router tests not named in GitHub CI workflow',
      'ci.yml missing test:kelly:rails:golden step'
    );
  }

  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(mpRoot, '..', 'package.json'), 'utf8')
  );
  const ciLocalHasGolden = String(rootPkg.scripts['ci:local'] || '').includes('test:kelly:rails:golden');
  dbg('H1', 'audit:ci-local', 'ci:local golden', { ciLocalHasGolden });
  if (!ciLocalHasGolden) {
    gap('G02', 'medium', 'ci:local does not explicitly run test:kelly:rails:golden', 'only npm test --prefix middleware-platform');
  }

  // H2: required artifacts
  const artifacts = [
    'tests/fixtures/kelly-rails-golden-utterances.json',
    'scripts/verify-kelly-rails-env.cjs',
    'scripts/e2e-kelly-rails-golden-conversations.cjs',
    '__tests__/kelly-rails-tool-allowlists.test.js',
    '__tests__/kelly-turn-resolver.test.js'
  ];
  for (const a of artifacts) {
    if (!fileExists(a)) gap('G03', 'critical', `Missing artifact: ${a}`, 'file not found');
  }

  // H3: runtime tests
  const jest = run('npm', ['run', 'test:kelly:rails:golden', '--silent'], {
    KELLY_RAILS_V2: '1',
    KELLY_ALLOW_HYBRID_GRAPH: '0'
  });
  dbg('H3', 'audit:jest', 'jest golden result', { code: jest.code });
  if (jest.code !== 0) {
    gap('G04', 'critical', 'test:kelly:rails:golden failed', jest.out.slice(-500));
  }

  const e2e = run('npm', ['run', 'test:e2e:kelly:golden-conversations', '--silent']);
  dbg('H3', 'audit:e2e', 'e2e golden result', { code: e2e.code });
  if (e2e.code !== 0) {
    gap('G05', 'critical', 'test:e2e:kelly:golden-conversations failed', e2e.out.slice(-500));
  }

  const llmSkipped = /LLM conversations \(skipped/.test(e2e.out);
  dbg('H2', 'audit:llm', 'LLM golden skipped', { llmSkipped });
  if (llmSkipped) {
    gap(
      'G06',
      'high',
      'Golden conversations 1–4 (LLM visit/payment) not executed in harness',
      'KELLY_GOLDEN_INCLUDE_LLM=1 only prints placeholder; no HTTP turn assertions'
    );
  }

  // H4: pay-before-book executeTurn (not just router)
  const { executeTurn } = require('../services/kelly-rails/execute-turn');
  const { KELLY_LANE } = require('../services/kelly-rails/state-schema');
  executeTurn({
    sessionId: 'gap-audit-pay-before-book',
    message: 'I want to pay my copay now',
    flags: { copay_amount: 25, appointment_id: null, has_rag: true, triage_complete: true },
    v2_hydrated: true
  }).then(({ state }) => {
    const redirected = state.active_lane === KELLY_LANE.BOOKING;
    dbg('H4', 'audit:pay-before-book', 'executeTurn redirect', {
      lane: state.active_lane,
      step: state.step,
      redirected
    });
    if (!redirected) {
      gap(
        'G07',
        'medium',
        'Pay-before-book: executeTurn must redirect to booking when payment gate closed',
        `lane=${state.active_lane} step=${state.step}`
      );
    }

    // H5: Switch 3 scope — no portal/video tools
    const postTools = require('../services/kelly-rails/tool-allowlists').getAllowedToolNames(
      'post_payment',
      'confirmation'
    );
    const hasPortal = postTools.some((t) => /portal|video|sms|session_link/i.test(t));
    dbg('H5', 'audit:switch3', 'post_payment tools', { postTools, hasPortal });
    if (hasPortal) {
      gap('G08', 'high', 'post_payment allow-list includes deferred portal/video tools', postTools.join(','));
    } else {
      gap(
        'G09',
        'info',
        'Switch 3 (provider session link) not implemented — by design Phase B = confirmation receipt only',
        `post_payment tools: ${postTools.join(', ')}`
      );
    }

    // H6: voice alignment
    const voiceTest = path.join(mpRoot, '__tests__/voice-triage-guards.test.js');
    const voiceContent = fileExists('__tests__/voice-triage-guards.test.js')
      ? fs.readFileSync(voiceTest, 'utf8')
      : '';
    const voiceKellyRails = /kelly-rails-voice-payment|payment.*voice|voice.*payment/i.test(voiceContent);
    const voicePaymentTest = fileExists('__tests__/kelly-rails-voice-payment.test.js');
    dbg('H6', 'audit:voice', 'voice payment test', { voicePaymentTest, voiceKellyRails });
    if (!voicePaymentTest) {
      gap(
        'G10',
        'medium',
        'Missing kelly-rails-voice-payment.test.js for voice payment lane allow-list',
        'add __tests__/kelly-rails-voice-payment.test.js'
      );
    }

    // H7: Cloud Run — local only check deploy yaml defaults
    const yamlGen = fs.readFileSync(path.join(mpRoot, 'scripts/generate-cloudrun-env-yaml.cjs'), 'utf8');
    const hybridDefault = /KELLY_ALLOW_HYBRID_GRAPH.*['"]1['"]/.test(yamlGen);
    dbg('H7', 'audit:deploy', 'hybrid in yaml gen', { hybridDefault });
    const cloudRun = spawnSync('node', ['scripts/verify-kelly-rails-cloudrun-env.cjs'], {
      cwd: mpRoot,
      encoding: 'utf8'
    });
    if (cloudRun.status === 1) {
      gap('G11', 'high', 'Live Cloud Run Kelly env check failed', cloudRun.stderr || cloudRun.stdout);
    } else if (cloudRun.status === 2) {
      gap(
        'G11',
        'medium',
        'Cloud Run env not verified (gcloud unavailable or auth)',
        'Run: npm run verify:kelly-rails-cloudrun --prefix middleware-platform'
      );
    }

    // H8: F2
    if (process.env.PHASE_B_AUDIT_REQUIRE_F2 === '1') {
      gap(
        'G12',
        'high',
        'F2 test:e2e:rcm:conversation not run in audit',
        'Run locally: RCM_E2E_USE_EXISTING_SERVER=1 npm run test:e2e:rcm:conversation'
      );
    }

    // Summary
    console.log('\n--- GAP REPORT ---\n');
    const order = { critical: 0, high: 1, medium: 2, info: 3 };
    gaps.sort((a, b) => order[a.severity] - order[b.severity]);
    for (const g of gaps) {
      console.log(`[${g.severity.toUpperCase()}] ${g.id} ${g.item}`);
      console.log(`         ${g.evidence}\n`);
    }
    console.log(`Total gaps: ${gaps.length}`);
    const blocking = gaps.filter((g) => g.severity === 'critical' || g.severity === 'high').length;
    console.log(`Blocking (critical+high): ${blocking}`);
    console.log('\nProduction-ready for Phase B rails/router code: ' + (blocking === 0 ? 'NO (ops/LLM gaps remain)' : 'NO'));
    process.exit(blocking > 0 ? 1 : 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
