'use strict';

const knowledgeService = require('../../services/knowledge-service');
const { CODING_CONFIDENCE_THRESHOLD } = require('../../config/coding-thresholds');
const { assert, parseJson } = require('./verify-assert.cjs');
const { fetchKellyEventsUnified } = require('./verify-db.cjs');

/**
 * Shared post-call coding spine checks for live + terminal verifiers.
 *
 * opts:
 *   scenario: 'copay_due' | 'fully_covered' | 'cannot_determine' | null
 *   provenanceExpected: 'spine' | 'spine or fallback'
 *   requireToolOrderInsuranceBeforeSchedule: boolean (live-call)
 *   requireAllowedAmount: boolean (live-call)
 */
function runCodingSpinePostCallChecks(db, dbMod, sessionId, opts = {}) {
  const checks = [];
  const scenario = opts.scenario || null;
  const provenanceExpected = opts.provenanceExpected || 'spine';

  const rag = db.prepare(
    'SELECT * FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId);
  checks.push(assert('triage_row_exists', !!rag, !!rag, true));
  checks.push(assert('primary_icd10', !!rag?.primary_icd10, rag?.primary_icd10, 'non-null'));
  checks.push(assert('primary_cpt', !!rag?.primary_cpt, rag?.primary_cpt, 'non-null'));
  checks.push(assert(
    'rag_confidence',
    (rag?.rag_confidence || 0) >= CODING_CONFIDENCE_THRESHOLD,
    rag?.rag_confidence,
    `>= ${CODING_CONFIDENCE_THRESHOLD}`
  ));

  const seeded = rag?.seeded_for_harness === 1 || rag?.seeded_for_harness === true;
  checks.push(assert('not_harness_seeded', !seeded, rag?.seeded_for_harness, '0 or null'));

  if (rag?.primary_icd10 && rag?.primary_cpt) {
    const v = knowledgeService.validateCodesExist({
      icd10: [rag.primary_icd10],
      cpt: [rag.primary_cpt]
    });
    checks.push(assert('codes_validate', v.valid, v.invalid, 'zero drops'));
  }

  const events = fetchKellyEventsUnified(dbMod || db, sessionId);
  const provenance = events.filter((e) => e.event_type === 'coding_provenance');
  const insEvent = provenance.find((e) => parseJson(e.payload_json).tool === 'collect_insurance');
  const insPayload = parseJson(insEvent?.payload_json);
  checks.push(assert('coding_provenance_logged', !!insEvent, insPayload.code_source, provenanceExpected));
  if (insPayload.code_source) {
    const spineOk = provenanceExpected === 'spine or fallback'
      ? insPayload.code_source === 'spine' || insPayload.code_source === 'fallback'
      : insPayload.code_source === 'spine';
    checks.push(assert('code_source_spine', spineOk, insPayload.code_source, provenanceExpected));
    checks.push(assert('not_assist_provenance', !insPayload.assist_phase, insPayload.assist_phase, undefined));
    checks.push(assert('fallback_reason_null', !insPayload.fallback_reason, insPayload.fallback_reason, null));
  }

  const toolEvents = events.filter((e) => e.event_type === 'tool_call' || e.event_type === 'kelly_tool');
  const toolOrder = toolEvents
    .map((e) => parseJson(e.payload_json).tool || parseJson(e.payload_json).name)
    .filter(Boolean);
  if (toolOrder.length) {
    const ragIdx = toolOrder.indexOf('run_triage_rag');
    const insIdx = toolOrder.indexOf('collect_insurance');
    const schedIdx = toolOrder.indexOf('schedule_appointment');
    if (ragIdx >= 0 && insIdx >= 0) {
      checks.push(assert('tool_order_rag_before_insurance', insIdx > ragIdx, toolOrder, 'run_triage_rag before collect_insurance'));
    }
    if (opts.requireToolOrderInsuranceBeforeSchedule && insIdx >= 0 && schedIdx >= 0) {
      checks.push(assert('tool_order_insurance_before_schedule', schedIdx > insIdx, toolOrder, 'collect_insurance before schedule'));
    }
  }

  const provJson = (() => {
    try {
      return JSON.parse(rag?.coding_provenance_json || '{}');
    } catch (_) {
      return {};
    }
  })();
  if (provJson.remote_source) {
    checks.push(assert(
      'remote_source_pinecone',
      String(provJson.remote_source).includes('pinecone'),
      provJson.remote_source,
      'pinecone'
    ));
  }
  if (provJson.code_pair_valid != null) {
    checks.push(assert('code_pair_valid', provJson.code_pair_valid === true, provJson.code_pair_valid, true));
  }

  const quote = db.prepare(
    'SELECT * FROM quote_audit WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId);

  if (scenario === 'cannot_determine') {
    checks.push(assert('quote_blocked', !quote || quote.status !== 'hard_number', quote?.status, 'not hard_number'));
  } else {
    checks.push(assert('quote_audit_row', !!quote, quote?.id, 'exists'));
    if (quote) {
      checks.push(assert('quote_hard_number', quote.status === 'hard_number', quote.status, 'hard_number'));
      const result = parseJson(quote.result_json);
      if (opts.requireAllowedAmount) {
        checks.push(assert('allowed_amount_set', result.allowed_amount != null, result.allowed_amount, 'non-null'));
      }
      const flatOk = quote.copay_due_now != null && (result.allowed_amount != null || quote.copay_due_now >= 0);
      checks.push(assert('quote_copay_or_allowed', flatOk, { copay: quote.copay_due_now, allowed: result.allowed_amount }, 'set'));
      if (scenario === 'copay_due') {
        checks.push(assert('copay_35', quote.copay_due_now === 35, quote.copay_due_now, 35));
      }
      if (scenario === 'fully_covered') {
        checks.push(assert('copay_0', quote.copay_due_now === 0, quote.copay_due_now, 0));
      }
      if (quote.rule_id) {
        const rule = db.prepare('SELECT id FROM plan_rules WHERE id = ?').get(quote.rule_id);
        checks.push(assert('rule_id_valid', !!rule, quote.rule_id, 'in plan_rules'));
      }
    }
    const appt = db.prepare(
      'SELECT created_at FROM appointments WHERE notes LIKE ? ORDER BY created_at DESC LIMIT 1'
    ).get(`%${sessionId}%`);
    if (quote && appt) {
      checks.push(assert(
        'booking_after_quote',
        appt.created_at >= quote.created_at,
        { appt: appt.created_at, quote: quote.created_at },
        'appt >= quote'
      ));
    }
  }

  const gateViolations = events.filter((e) => e.event_type === 'gate_violation');
  checks.push(assert('no_gate_violations', gateViolations.length === 0, gateViolations.length, 0));

  return checks;
}

module.exports = { runCodingSpinePostCallChecks, CODING_CONFIDENCE_THRESHOLD };
