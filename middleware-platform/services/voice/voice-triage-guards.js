'use strict';

/**
 * Voice HTTP triage parity: shared guardrails for `/voice/appointments/*`, `/voice/insurance/collect`, etc.
 * Extracted from server.js (impl-1) — edit here only to avoid drift.
 *
 * @see docs/architecture/README.md#commerce-agentic-checkout-file-map (booking/checkout gates)
 * @see docs/middleware-platform/README.md#voice-triage-parity (repo root)
 */

const KellyToolExecutor = require('../kelly/kelly-tool-executor');
const db = require('../../database');

/**
 * Resolve triage session key from request body (Kelly + Retell shapes).
 *
 * **Priority (impl-14)** — first non-empty wins; do not merge conflicting ids:
 * 1. `args.session_id` (explicit top-level)
 * 2. `args.metadata.session_id`
 * 3. `args.call_id` or `args.callId` (Retell voice id)
 * 4. `req.body.session_id` (flat body)
 * 5. `req.body.metadata.session_id`
 *
 * If callers send both `session_id` and `call_id` with different values, **`session_id` wins** (steps 1–2 before 3).
 */
function resolveVoiceSessionIdForGuard(args, req) {
  const a = args || {};
  const body = req && req.body ? req.body : {};
  const candidates = [
    pickSid(a.session_id),
    pickSid(a.metadata && a.metadata.session_id),
    pickSid(a.call_id),
    pickSid(a.callId),
    pickSid(body.session_id),
    pickSid(body.metadata && body.metadata.session_id),
    pickSid(body.args && body.args.session_id),
    pickSid(body.args && body.args.metadata && body.args.metadata.session_id),
    pickSid(body.args && body.args.call_id)
  ];
  for (const c of candidates) {
    if (c) return c;
  }
  return null;
}

function pickSid(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * When REQUIRE_TRIAGE_FOR_VOICE=1, voice booking endpoints must include session_id or call_id.
 */
function requireVoiceSessionIdForTriageParity(req, res) {
  const required =
    process.env.REQUIRE_TRIAGE_FOR_VOICE === '1' || process.env.REQUIRE_TRIAGE_FOR_VOICE === 'true';
  if (!required) return true;
  const args = req.body.args || req.body;
  const sid = resolveVoiceSessionIdForGuard(args, req);
  if (!sid) {
    res.status(400).json({
      success: false,
      error: 'SESSION_ID_REQUIRED',
      error_code: 'SESSION_ID_REQUIRED',
      message:
        'session_id or call_id is required for voice booking when REQUIRE_TRIAGE_FOR_VOICE is enabled.'
    });
    return false;
  }
  return true;
}

function bumpCounter(bumpOp, suffix) {
  const name =
    bumpOp === 'insurance'
      ? `voice_agent_misuse_http_collect_insurance_${suffix}`
      : `voice_agent_misuse_http_${bumpOp}_${suffix}`;
  try {
    db.incrementOpsCounter && db.incrementOpsCounter(name);
  } catch (_) {}
}

function threshold() {
  const { CODING_CONFIDENCE_THRESHOLD } = require('../../config/coding-thresholds');
  const v = process.env.RAG_CONFIDENCE_THRESHOLD ?? String(CODING_CONFIDENCE_THRESHOLD);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : CODING_CONFIDENCE_THRESHOLD;
}

/**
 * Pure evaluation of triage DB gates (no Express). Use from **Patient Orchestrator** (C1) when a
 * `triage_sessions` row exists for `patient_orchestrate_sessions.session_id`.
 *
 * @returns {{ ok: true } | { ok: false, bump: string, body: object }}
 */
function evaluateTriageGuardrailsForSession(sessionIdForGuard, args, bumpOp = 'schedule') {
  if (!sessionIdForGuard || !db.getTriageSession) {
    return { ok: true };
  }

  const THRESHOLD = threshold();
  const routineNoSymptoms = KellyToolExecutor._routineNoSymptomsEffective
    ? KellyToolExecutor._routineNoSymptomsEffective(sessionIdForGuard)
    : false;
  const allowRoutineBypass = routineNoSymptoms && (bumpOp === 'slots' || bumpOp === 'schedule');
  const sessionRow = db.getTriageSession(sessionIdForGuard);

  if (!sessionRow) {
    if (allowRoutineBypass) return { ok: true };
    const ins = bumpOp === 'insurance';
    return {
      ok: false,
      bump: 'triage_not_started',
      body: {
        success: false,
        error: 'TRIAGE_NOT_STARTED',
        error_code: 'TRIAGE_NOT_STARTED',
        message: ins
          ? 'No triage session found for this call yet. Complete intake and run_triage_rag before verifying insurance.'
          : bumpOp === 'slots'
            ? 'No triage session found for this call yet. Complete intake and run_triage_rag before looking up slots.'
            : 'No triage session found for this call yet. Complete intake and run_triage_rag before scheduling.'
      }
    };
  }

  const isSafetyRed =
    sessionRow.safety_level === 'red' ||
    sessionRow.referred_to_911 === 1 ||
    sessionRow.referred_to_911 === true;
  const providerOverrideEmergency =
    args?.provider_override_emergency === true || args?.provider_override_emergency === 'true';

  const triageResult = require('../clinical/triage-rag-service').getAuthoritativeForSession?.(sessionIdForGuard) || null;
  const confidence = KellyToolExecutor._confidenceFromTriageRow(triageResult);
  const triageComplete = sessionRow.triage_complete === 1 || sessionRow.triage_complete === true;

  if (isSafetyRed && !providerOverrideEmergency) {
    const safetyMsg =
      bumpOp === 'insurance'
        ? 'Insurance verification is blocked because this session was flagged as emergency/red safety.'
        : bumpOp === 'slots'
          ? 'Slot lookup is blocked because this session was flagged as emergency/red safety.'
          : 'Scheduling is blocked because this session was flagged as emergency/red safety.';
    return {
      ok: false,
      bump: 'safety_blocked',
      body: {
        success: false,
        error: 'SAFETY_BLOCKED',
        error_code: 'SAFETY_BLOCKED',
        message: safetyMsg
      }
    };
  }

  if (allowRoutineBypass) {
    const triageResult = require('../clinical/triage-rag-service').getAuthoritativeForSession?.(sessionIdForGuard) || null;
    const preventiveIcd = triageResult?.primary_icd10
      && (() => {
        try {
          const { isPreventiveIcd } = require('../clinical/preventive-visit-spine');
          return isPreventiveIcd(triageResult.primary_icd10);
        } catch (_) {
          return false;
        }
      })();
    if (!preventiveIcd) {
      return {
        ok: false,
        bump: 'routine_missing_preventive_spine',
        body: {
          success: false,
          error: 'TRIAGE_INCOMPLETE',
          error_code: 'TRIAGE_INCOMPLETE',
          message: 'Routine visits require preventive diagnosis codes from the coding spine before scheduling.'
        }
      };
    }
    return { ok: true };
  }

  if (!triageComplete) {
    return {
      ok: false,
      bump: 'triage_incomplete',
      body: {
        success: false,
        error: 'TRIAGE_INCOMPLETE',
        error_code: 'TRIAGE_INCOMPLETE',
        message:
          bumpOp === 'insurance'
            ? 'Triage is not complete yet. Please complete triage (run_triage_rag) before verifying insurance.'
            : bumpOp === 'slots'
              ? 'Triage is not complete yet. Complete triage before looking up available slots.'
              : 'Triage is not complete yet. Please complete triage (run_triage_rag) before scheduling.'
      }
    };
  }

  if (confidence < THRESHOLD && bumpOp !== 'insurance') {
    return {
      ok: false,
      bump: 'low_confidence',
      body: {
        success: false,
        error: 'LOW_CONFIDENCE',
        error_code: 'LOW_CONFIDENCE',
        message:
          'RAG confidence is low. Please clarify symptoms and re-run triage before continuing.'
      }
    };
  }

  if (!(sessionRow.opqrst_complete === 1 || sessionRow.opqrst_complete === true)) {
    // opqrst_complete is set only via store_triage_opqrst (P-2 opqrstComplete in kelly-tool-executor).
    return {
      ok: false,
      bump: 'opqrst_missing',
      body: {
        success: false,
        error: 'OPQRST_REQUIRED',
        error_code: 'OPQRST_REQUIRED',
        message:
          bumpOp === 'insurance'
            ? 'Please complete the OPQRST clinical history before verifying insurance.'
            : 'Please complete the OPQRST clinical history before we continue.'
      }
    };
  }

  if (!sessionRow.intake_complete_at) {
    return {
      ok: false,
      bump: 'rich_intake_missing',
      body: {
        success: false,
        error: 'RICH_INTAKE_REQUIRED',
        error_code: 'RICH_INTAKE_REQUIRED',
        message:
          bumpOp === 'insurance'
            ? 'Please complete the rich intake (medications, allergies, and key history) before verifying insurance.'
            : 'Please complete the rich intake (medications, allergies, and key history) before we continue.'
      }
    };
  }

  return { ok: true };
}

/**
 * DB triage guardrails when session/call id is present (Kelly path + Retell direct with session_id).
 * Returns false if res already sent (403). Returns true to proceed.
 */
function enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, bumpOp = 'schedule') {
  const ev = evaluateTriageGuardrailsForSession(sessionIdForGuard, args, bumpOp);
  if (ev.ok) return true;
  try {
    db.insertKellyCallEvent?.({
      session_id: sessionIdForGuard || null,
      event_type: 'guardrail_blocked',
      payload_json: {
        operation: bumpOp,
        bump: ev.bump,
        error_code: ev.body?.error_code || null
      }
    });
  } catch (_) {}
  bumpCounter(bumpOp, ev.bump);
  res.status(403).json(ev.body);
  return false;
}

module.exports = {
  resolveVoiceSessionIdForGuard,
  requireVoiceSessionIdForTriageParity,
  evaluateTriageGuardrailsForSession,
  enforceVoiceTriageGuardrailsForSession
};
