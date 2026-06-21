#!/usr/bin/env node
'use strict';

/**
 * Session 1 acceptance — live Pinecone spine regression (no seed).
 *
 * PASS when:
 *   - 5/5 fixtures ok
 *   - each ok fixture: plausible_icd, top_confidence >= 0.65, remote_source includes pinecone, validate_drops === 0
 *   - total runtime < 90s (no parent execSync timeout)
 *
 * Run:
 *   REMOTE_RAG_TIMEOUT_MS=8000 EVAL_USE_SEMANTIC=false \
 *     DB_PATH=./var/db/middleware-dev.db node scripts/verify-live-spine.cjs
 * exit 0
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
process.env.SKIP_STARTUP_MIGRATIONS = '1';
process.env.EVAL_USE_SEMANTIC = process.env.EVAL_USE_SEMANTIC ?? 'false';
process.env.REMOTE_RAG_TIMEOUT_MS = process.env.REMOTE_RAG_TIMEOUT_MS || '8000';

const knowledgeService = require('../services/knowledge-service');
const { CODING_CONFIDENCE_THRESHOLD } = require('../config/coding-thresholds');

const FIXTURES = [
  { complaint: 'stomach pain since this morning', icd_prefixes: ['K2', 'K5', 'R10'] },
  { complaint: 'persistent headache with light sensitivity', icd_prefixes: ['G43', 'G44', 'R51'] },
  { complaint: 'chest tightness and shortness of breath', icd_prefixes: ['I20', 'R06', 'R07', 'J44'] },
  { complaint: 'right knee swelling after running', icd_prefixes: ['M23', 'S8', 'M25'] },
  { complaint: 'persistent dry cough for 2 weeks', icd_prefixes: ['J0', 'R05', 'J44'] }
];

function icdMatches(code, prefixes) {
  const norm = String(code || '').replace(/\./g, '').toUpperCase();
  return prefixes.some((p) => norm.startsWith(p.toUpperCase()));
}

const FIXTURE_TIMEOUT_MS = parseInt(process.env.PHASE1_LIVE_SPINE_FIXTURE_TIMEOUT_MS || '15000', 10);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

async function runFixture(f) {
  const dual = await withTimeout(
    knowledgeService.getCodeCandidatesDualSource(f.complaint, {
      maxIcd10: 10,
      maxCpt: 5,
      useSemantic: process.env.EVAL_USE_SEMANTIC === 'true',
      remoteTimeoutMs: parseInt(process.env.REMOTE_RAG_TIMEOUT_MS || '8000', 10)
    }),
    FIXTURE_TIMEOUT_MS,
    f.complaint
  );
  const icd10 = (dual.icd10 || []).map((c) => c.code);
  const cpt = (dual.cpt || []).map((c) => c.code);
  const topIcd = icd10[0] || null;
  const topConf = Math.max(dual.icd10?.[0]?.confidence || 0, dual.cpt?.[0]?.confidence || 0);
  const remote = dual.remote_knowledge?.metadata?.source || 'none';
  const validation = knowledgeService.validateCodesExist({ icd10, cpt });
  const drops = validation.invalid.icd10.length + validation.invalid.cpt.length + validation.invalid.hcpcs.length;
  const plausible = topIcd ? icdMatches(topIcd, f.icd_prefixes) : false;
  const topCpt = cpt[0] || null;
  const ok = plausible && topConf >= CODING_CONFIDENCE_THRESHOLD && remote.includes('pinecone') && drops === 0 && !!topCpt;
  return {
    complaint: f.complaint,
    top_icd10: topIcd,
    top_cpt: topCpt,
    top_confidence: topConf,
    remote_source: remote,
    validate_drops: drops,
    plausible_icd: plausible,
    ok
  };
}

async function main() {
  const started = Date.now();
  if (process.env.PHASE1_LIVE_SPINE_SKIP === '1') {
    console.log(JSON.stringify({ skipped: true, reason: 'PHASE1_LIVE_SPINE_SKIP=1', success: true }, null, 2));
    process.exit(0);
  }
  const results = [];
  for (const f of FIXTURES) {
    try {
      results.push(await runFixture(f));
    } catch (e) {
      results.push({ complaint: f.complaint, ok: false, error: e.message });
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const elapsedMs = Date.now() - started;
  const summary = {
    passed,
    total: FIXTURES.length,
    pass_bar: 5,
    threshold: CODING_CONFIDENCE_THRESHOLD,
    elapsed_ms: elapsedMs,
    results,
    success: passed >= 5 && elapsedMs < 90000
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.success ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
