#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.resolve(process.env.REASONING_HARNESS_ARTIFACT_DIR || path.join(ROOT, 'test-results', 'readiness-artifacts'));
const runArtifact = path.join(ARTIFACT_DIR, 'prod-full-scan-chat-e2e-signoff.json');
const evalArtifact = path.join(ARTIFACT_DIR, 'prod-full-scan-chat-semantic-signoff.json');

function fail(msg) {
  console.error(`FAIL ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`PASS ${msg}`);
}

function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const run = spawnSync(process.execPath, ['./scripts/playwright-full-scan-chat-e2e.cjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '0' }
  });
  if (run.status !== 0) {
    try {
      const maybe = JSON.parse(String(run.stdout || '{}'));
      fs.writeFileSync(runArtifact, JSON.stringify(maybe, null, 2));
    } catch (_) {
      fs.writeFileSync(runArtifact, JSON.stringify({ ok: false, error: String(run.stderr || run.stdout || 'e2e_failed') }, null, 2));
    }
    fail('PROD_FULL_SCAN_CHAT_E2E');
  }

  let result = null;
  try {
    result = JSON.parse(String(run.stdout || '{}'));
  } catch (e) {
    fail(`PROD_FULL_SCAN_CHAT_E2E_PARSE ${e.message}`);
  }
  fs.writeFileSync(runArtifact, JSON.stringify(result, null, 2));

  const assistant = Array.isArray(result?.transcript?.assistant) ? result.transcript.assistant : [];
  const t1 = String(assistant[assistant.length - 2] || '').toLowerCase();
  const t2 = String(assistant[assistant.length - 1] || '').toLowerCase();
  const semanticScanReference = /(fruit snacks|orange juice|scan|barcode|food|ingredient|product|category route)/i.test(t1);
  const semanticNoGenericFallback = !/(don't see|do not see|what product did you scan|could you share.*product|what symptom or concern should we focus on next|which part of your body is affected)/i.test(t1);
  const semanticTurnContinuity = /(low risk|generally safe|children|parent|practical|takeaway|product|fruit snacks|orange juice)/i.test(t2);
  const verdict = Boolean(result?.ok) && semanticScanReference && semanticNoGenericFallback && semanticTurnContinuity ? 'PASS' : 'FAIL';

  const summary = {
    run_at: new Date().toISOString(),
    ui_base_url: result?.ui_base_url || null,
    api_base: result?.api_base || null,
    ok: Boolean(result?.ok),
    barcode_lookup: result?.barcode_lookup || null,
    pinned_context: result?.pinned_context || null,
    assertions: {
      semantic_scan_reference: semanticScanReference,
      semantic_no_generic_fallback: semanticNoGenericFallback,
      semantic_turn_continuity: semanticTurnContinuity
    },
    verdict,
    assistant_last_two: [assistant[assistant.length - 2] || null, assistant[assistant.length - 1] || null]
  };
  fs.writeFileSync(evalArtifact, JSON.stringify(summary, null, 2));

  if (verdict !== 'PASS') {
    console.log(JSON.stringify(summary, null, 2));
    fail('PROD_FULL_SCAN_CHAT_SEMANTIC_SIGNOFF');
  }
  pass('PROD_FULL_SCAN_CHAT_SEMANTIC_SIGNOFF');
  console.log(JSON.stringify(summary, null, 2));
}

main();

