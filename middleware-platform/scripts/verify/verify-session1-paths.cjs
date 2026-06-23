#!/usr/bin/env node
'use strict';

/**
 * Session 1 — confirm spine code paths are wired (no network).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mp = path.join(__dirname, '..');
const checks = [];

function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (e) {
    checks.push({ name, ok: false, error: e.message });
  }
}

check('kelly-tool-executor USE_TRIAGE_RAG_V2 switch', () => {
  const src = fs.readFileSync(path.join(mp, 'services/kelly-tool-executor.js'), 'utf8');
  assert(src.includes("USE_TRIAGE_RAG_V2"), 'missing USE_TRIAGE_RAG_V2');
  assert(src.includes('TriageRAGServiceV2'), 'missing TriageRAGServiceV2 import/use');
  assert(src.includes("case 'run_triage_rag'"), 'missing run_triage_rag tool');
});

check('triage-rag-service-v2 dual-source', () => {
  const src = fs.readFileSync(path.join(mp, 'services/triage-rag-service-v2.js'), 'utf8');
  assert(src.includes('getCodeCandidatesDualSource'), 'dual-source not used');
});

check('knowledge-service merge+validate', () => {
  const ks = require('../../services/shared/knowledge-service');
  assert(typeof ks.getCodeCandidatesDualSource === 'function', 'getCodeCandidatesDualSource missing');
  assert(typeof ks.validateCodesExist === 'function', 'validateCodesExist missing');
});

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ checks, success: failed.length === 0 }, null, 2));
process.exit(failed.length ? 2 : 0);
