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

  it('mode-tool-firewall default-deny blocks unregistered tools', () => {
    const { isToolAllowedForMode } = require('../services/conversation-mode/mode-tool-firewall');
    expect(
      isToolAllowedForMode('fake_tool_not_in_registry', {
        conversation_mode: 'tenant_inbound_admin',
        active_subrail: 'booking',
        site_context_status: 'verified',
        triage_policy: 'disabled'
      })
    ).toBe(false);
  });

  it('KellyToolExecutor.execute enforces mode firewall (4.1)', () => {
    const src = read('services/kelly-tool-executor.js');
    expect(src).toMatch(/isToolAllowedForMode/);
    expect(src).toMatch(/MODE_FIREWALL_BLOCKED/);
    expect(src).not.toMatch(/_skipModeFirewall.*true/);
  });

  it('Retell replayFunctionCall includes clinical Kelly tools (4.2)', () => {
    const src = read('webhooks/retell-websocket.js');
    expect(src).toMatch(/case 'run_triage_rag'/);
    expect(src).toMatch(/case 'store_triage_opqrst'/);
    expect(src).toMatch(/case 'compute_visit_quote'/);
    expect(src).toMatch(/case 'request_patient_payment'/);
    expect(src).toMatch(/MODE_FIREWALL_BLOCKED/);
  });

  it('Retell modeCtx includes triage_policy and use_case (4.3)', () => {
    const src = read('webhooks/retell-websocket.js');
    expect(src).toMatch(/triage_policy:/);
    expect(src).toMatch(/use_case:/);
    expect(src).toMatch(/_buildRetellModeCtx/);
  });

  it('handleScheduleAppointment no longer has provider_override_emergency bypass (4.5)', () => {
    const src = read('webhooks/retell-websocket.js');
    const method = src.slice(
      src.indexOf('async handleScheduleAppointment'),
      src.indexOf('// Handle patient_intake function')
    );
    expect(method).not.toMatch(/provider_override_emergency/);
    expect(method).toMatch(/KellyToolExecutor\.execute/);
  });

  it('collect_insurance Retell schema omits service_code (4.6)', () => {
    const schema = JSON.parse(read('retell-functions/retell-functions.json'));
    const collect = schema.functions.find((f) => f.name === 'collect_insurance');
    expect(collect).toBeTruthy();
    expect(collect.parameters.properties.service_code).toBeUndefined();
  });

  it('coding resolve layers are labeled in collect path (4.9)', () => {
    const kelly = read('services/kelly-tool-executor/collect-insurance.js');
    const http = read('services/voice-insurance-spine-handler.js');
    expect(kelly).toMatch(/\[coding_resolve\].*kelly_executor.*authoritative=true/);
    expect(http).toMatch(/\[coding_resolve\].*http_spine/);
  });

  it('verify-kelly-rails-env checks CALLSOMO_OPERATOR_FALLBACK_PSTN (4.10)', () => {
    const src = read('scripts/verify-kelly-rails-env.cjs');
    expect(src).toMatch(/CALLSOMO_OPERATOR_FALLBACK_PSTN/);
  });

  it('Retell primary switch routes collect_insurance through KellyToolExecutor (G-08)', () => {
    const src = read('webhooks/retell-websocket.js');
    const switchBlock = src.slice(src.indexOf("case 'collect_insurance'"), src.indexOf("case 'collect_insurance'") + 800);
    expect(switchBlock).toMatch(/KellyToolExecutor\.execute/);
  });

  it('legacy handleCollectInsurance axios bypass is not invoked from switch', () => {
    const src = read('webhooks/retell-websocket.js');
    const switchArea = src.slice(src.indexOf("case 'collect_insurance'"), src.indexOf("case 'schedule_appointment'"));
    expect(switchArea).not.toMatch(/handleCollectInsurance/);
  });

  it('Retell coding search tools exist but should migrate to Kelly spine (G-08)', () => {
    const src = read('webhooks/retell-websocket.js');
    expect(src).toMatch(/case 'search_icd10_codes'/);
    expect(src).toMatch(/case 'search_cpt_codes'/);
    expect(src).toMatch(/case 'validate_code_pair'/);
  });

  it('hipaa-production-guards blocks KELLY_RAILS_FAST_RAG in production (F-05)', () => {
    const { getKellyRoutingViolations } = require('../services/hipaa-production-guards');
    const violations = getKellyRoutingViolations({
      NODE_ENV: 'production',
      CLOUDRUN_PROFILE: 'production',
      KELLY_RAILS_FAST_RAG: '1',
      CONVERSATION_MODE_ROUTING: 'enforce'
    });
    expect(violations.some((v) => /KELLY_RAILS_FAST_RAG/.test(v))).toBe(true);
  });
});
