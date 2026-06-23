'use strict';

const { KELLY_LANE } = require('./state-schema');
const OpqrstFieldGate = require('../../clinical/opqrst-field-gate');
const { isOpqrstFieldGateEnabled } = require('./config');

const OPEN_FIELD_TO_SUBRAIL_STEP = {
  onset: 'onset',
  provocation: 'provocation',
  quality: 'quality',
  radiation: 'region',
  severity: 'severity',
  timing: 'timing'
};

function loadTriagePolicy(ctx = {}) {
  let triagePolicy = 'conditional';
  try {
    const db = require('../../../database');
    const { loadTenantPolicyFromProfile } = require('../../conversation/tenant-policy');
    triagePolicy =
      loadTenantPolicyFromProfile(db, ctx.clinicId, ctx.customerId)?.triage_policy || 'conditional';
  } catch (_) {}
  return triagePolicy;
}

function isOpqrstComplete(triageRow, ctx = {}) {
  if (!triageRow) return false;
  const triagePolicy = loadTriagePolicy(ctx);
  return OpqrstFieldGate.opqrstComplete(triageRow, {
    triagePolicy,
    specialty: triageRow?.target_specialty
  });
}

/**
 * True when OPQRST checklist is incomplete and RAG has not finished.
 */
function isOpqrstInProgress(state = {}, triageRow = null, ctx = {}) {
  if (!isOpqrstFieldGateEnabled()) return false;
  if (state.flags?.has_rag || state.flags?.triage_complete || triageRow?.rag_result_id) {
    return false;
  }
  if (isOpqrstComplete(triageRow, ctx)) return false;

  const gate = state.flags?._opqrst_gate;
  const mode = state.conversation_mode || state.flags?.conversation_mode;
  const subrail = state.active_subrail || state.flags?.active_subrail;
  const clinicalContext =
    state.active_lane === KELLY_LANE.CLINICAL ||
    mode === 'tenant_inbound_clinical' ||
    subrail === 'opqrst' ||
    !!state.flags?.opqrst_in_progress;

  if (!clinicalContext && !OpqrstFieldGate.hasPartialTriage(triageRow) && !gate?.openField) {
    return false;
  }

  return (
    OpqrstFieldGate.hasPartialTriage(triageRow) ||
    !!gate?.openField ||
    subrail === 'opqrst' ||
    mode === 'tenant_inbound_clinical' ||
    state.active_lane === KELLY_LANE.CLINICAL
  );
}

function openFieldToSubrailStep(openField) {
  if (!openField) return null;
  return OPEN_FIELD_TO_SUBRAIL_STEP[openField] || openField;
}

function syncOpqrstSubrailStep(state, openField) {
  if (!openField) return;
  state.active_subrail = 'opqrst';
  state.flags.active_subrail = 'opqrst';
  const step = openFieldToSubrailStep(openField);
  if (step) {
    state.active_subrail_step = step;
    state.flags.active_subrail_step = step;
  }
}

function enforceClinicalOpqrstLane(state = {}) {
  const gate = state.flags?._opqrst_gate;
  state.active_lane = KELLY_LANE.CLINICAL;
  state.conversation_mode = 'tenant_inbound_clinical';
  state.flags.conversation_mode = 'tenant_inbound_clinical';
  state.flags.opqrst_in_progress = true;
  if (!state.step || state.step === 'identity' || state.step === 'await_intent') {
    state.step = 'symptoms';
  }
  syncOpqrstSubrailStep(state, gate?.openField || state.flags?.opqrst_resume_field);
}

function scriptedLineForOpenField(openField, locale, specialty) {
  if (!openField) return null;
  const def = OpqrstFieldGate.FIELD_DEFS.find((d) => d.field === openField);
  if (!def) return null;
  const { getNextQuestion } = require('../../clinical/clinical-opqrst-registry');
  const specKey = String(specialty || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_') || null;
  const scripted = getNextQuestion(String(locale || 'en').slice(0, 2), def.stepId, specKey);
  return scripted?.text || null;
}

function nextOpenFieldAfterStore(triageRow, ctx = {}) {
  const triagePolicy = loadTriagePolicy(ctx);
  return OpqrstFieldGate.firstOpenField(triageRow, {
    triagePolicy,
    specialty: triageRow?.target_specialty,
    opqrstResumeField: null
  });
}

function resolveOpqrstFallbackReply(state = {}, triageRow = null, ctx = {}) {
  const gate = state.flags?._opqrst_gate;
  if (!gate) return null;

  const locale = state.locale || state.flags?.locale || 'en';
  const specialty = triageRow?.target_specialty || null;

  if (gate.scriptedLine) return gate.scriptedLine;

  if (gate.userAnsweredOpenField) {
    const nextField = nextOpenFieldAfterStore(triageRow, ctx);
    if (nextField) {
      const nextLine = scriptedLineForOpenField(nextField, locale, specialty);
      if (nextLine) return `Thanks. ${nextLine}`;
    }
  }

  if (gate.openField) {
    return scriptedLineForOpenField(gate.openField, locale, specialty);
  }

  return null;
}

module.exports = {
  OPEN_FIELD_TO_SUBRAIL_STEP,
  isOpqrstInProgress,
  isOpqrstComplete,
  enforceClinicalOpqrstLane,
  syncOpqrstSubrailStep,
  resolveOpqrstFallbackReply,
  scriptedLineForOpenField,
  openFieldToSubrailStep
};
