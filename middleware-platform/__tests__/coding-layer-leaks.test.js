'use strict';

const { KELLY_TOOLS } = require('../services/kelly-agent-service');
const fs = require('fs');
const path = require('path');

const mp = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(mp, rel), 'utf8');
}

describe('coding layer leak regression', () => {
  it('collect_insurance and compute_visit_quote are in KELLY_TOOLS', () => {
    const names = KELLY_TOOLS.map((t) => t.function?.name);
    expect(names).toContain('collect_insurance');
    expect(names).toContain('compute_visit_quote');
    expect(names).toContain('run_triage_rag');
  });

  it('execute-turn does not reference fast-complete', () => {
    const src = read('services/kelly-rails/execute-turn.js');
    expect(src).not.toMatch(/completeTriageRagForSession/);
    expect(src).not.toMatch(/triage-rag-fast-complete/);
    expect(src).toMatch(/applyCodingHitlResume/);
  });

  it('opqrst gate does not use fast-complete', () => {
    const src = read('services/kelly-rails/gates/opqrst.js');
    expect(src).not.toMatch(/completeTriageRagForSession/);
    expect(src).not.toMatch(/triage-rag-fast-complete/);
  });

  it('voice HTTP insurance path uses resolveInsuranceCodes not getCptCodeForVisit fallback', () => {
    const src = read('services/voice-insurance-spine-handler.js');
    expect(src).toMatch(/resolveInsuranceCodes/);
    expect(src).not.toMatch(/getCptCodeForVisit\s*\(/);
  });

  it('terminal coding call does not inject hardcoded 99213', () => {
    const src = read('scripts/terminal-coding-call.cjs');
    expect(src).not.toMatch(/primary_cpt\s*=\s*['"]99213['"]/);
    expect(src).toMatch(/--no-assist/);
  });

  it('resolveInsuranceCodes blocks invalid code pairs', () => {
    const src = read('services/resolve-insurance-codes.js');
    expect(src).toMatch(/validateCodePair/);
    expect(src).toMatch(/invalid_code_pair|pairCheck\.valid/);
  });

  it('collect_insurance POST omits service_code', () => {
    const src = read('services/kelly-tool-executor/collect-insurance.js');
    const block = src.slice(src.indexOf("executor._post('/voice/insurance/collect'"));
    expect(block).not.toMatch(/service_code:\s*serviceCode/);
    expect(block).not.toMatch(/service_code:\s*args\.service_code/);
  });

  it('coding thresholds SSOT exports HITL and inference constants', () => {
    const thresholds = require('../config/coding-thresholds');
    expect(thresholds.CODING_CONFIDENCE_THRESHOLD).toBe(0.65);
    expect(thresholds.CODING_HITL_APPROVED_CONFIDENCE).toBeGreaterThanOrEqual(0.65);
    expect(thresholds.CPT_INFERENCE_CONFIDENCE).toBeGreaterThanOrEqual(0.65);
  });
});
