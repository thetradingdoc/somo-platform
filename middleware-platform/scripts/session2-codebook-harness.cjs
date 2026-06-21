#!/usr/bin/env node
'use strict';

/**
 * Session 2 terminal harness — codebook parity + triage validateCodesExist drops.
 * Usage: DB_PATH=./var/db/middleware-dev.db node scripts/session2-codebook-harness.cjs
 */

const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
process.env.SKIP_STARTUP_MIGRATIONS = '1';
process.env.USE_TRIAGE_RAG_V2 = process.env.USE_TRIAGE_RAG_V2 || '1';
process.env.REMOTE_RAG_TIMEOUT_MS = process.env.REMOTE_RAG_TIMEOUT_MS || '8000';

const SYMPTOM = process.env.SESSION2_SYMPTOM || 'stomach pain since yesterday with nausea after meals';

async function main() {
  const mp = path.join(__dirname, '..');

  console.log('==> Codebook parity');
  const parityRaw = execSync('node scripts/verify-codebook-parity.js 2>/dev/null', {
    cwd: mp,
    encoding: 'utf8',
    env: process.env
  });
  console.log(parityRaw);
  const parity = JSON.parse(parityRaw.match(/\{[\s\S]*\}/)[0]);
  if (!parity.icd10?.ok || !parity.cpt?.ok || !parity.hcpcs?.ok || !parity.embeddings?.ok || !parity.em_codes?.ok) {
    process.exit(2);
  }

  const TriageRAGServiceV2 = require('../services/triage-rag-service-v2');
  const knowledgeService = require('../services/knowledge-service');

  // Skip HyDE for harness speed/reliability (Session 2 validates codebook + validateCodesExist).
  const savedOpenAi = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const triage = await TriageRAGServiceV2.enrichFromSymptoms({
    sessionId: `sess_s2_${Date.now()}`,
    symptomText: SYMPTOM,
    opqrst: { onset: 'yesterday', quality: 'cramping', severity: 6, timing: 'intermittent' },
    richIntake: { medications: 'none', allergies: 'none' },
    clinicId: 'clinic-default'
  });

  if (savedOpenAi) process.env.OPENAI_API_KEY = savedOpenAi;

  const icdCodes = [
    triage.primary_icd10,
    ...(triage.icd_codes || []).map((c) => c.code)
  ].filter(Boolean);
  const cptCodes = [
    triage.primary_cpt,
    ...(triage.cpt_codes || []).map((c) => c.code)
  ].filter(Boolean);

  const validation = knowledgeService.validateCodesExist({
    icd10: icdCodes,
    cpt: cptCodes
  });

  const drops = {
    icd10: validation.invalid.icd10.length,
    cpt: validation.invalid.cpt.length,
    hcpcs: validation.invalid.hcpcs.length
  };
  const totalDrops = drops.icd10 + drops.cpt + drops.hcpcs;

  const result = {
    symptom: SYMPTOM,
    db_path: process.env.DB_PATH,
    primary_icd10: triage.primary_icd10 || null,
    primary_cpt: triage.primary_cpt || null,
    icd_codes_checked: icdCodes.length,
    cpt_codes_checked: cptCodes.length,
    validate_drops: drops,
    zero_drops: totalDrops === 0,
    assertion_passed: totalDrops === 0 && icdCodes.length > 0
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.assertion_passed ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
