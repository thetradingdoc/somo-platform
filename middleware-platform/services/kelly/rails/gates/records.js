'use strict';

const { KELLY_LANE } = require('../state-schema');
const { GATE_OUTCOME } = require('../phase-enums');
const { getDeterministicReply } = require('../prompts/deterministic');
const { executeDeterministicTool } = require('./shared');

async function runDeterministicRecords(state, ctx) {
  if (state.active_lane !== KELLY_LANE.RECORDS) return null;
  if (state.step !== 'records_qa' && state.conversation_mode !== 'tenant_records') return null;

  const locale = state.locale || 'en';
  const query = String(ctx.message || '').trim();
  if (!query) return null;

  const out = await executeDeterministicTool(
    KELLY_LANE.RECORDS,
    'records_qa',
    'query_patient_records',
    { query, patient_id: ctx.patientId },
    ctx
  );

  const answer = out?.answer || out?.message;
  if (answer && out?.success !== false) {
    return {
      reply: getDeterministicReply('records_answer', locale, { answer }),
      toolsUsed: ['query_patient_records'],
      endCall: false,
      outcome: GATE_OUTCOME.HANDLED
    };
  }

  if (out?.success === false) {
    return {
      reply: getDeterministicReply('records_failed', locale),
      toolsUsed: ['query_patient_records'],
      endCall: false,
      outcome: GATE_OUTCOME.FAILED
    };
  }

  return {
    reply: getDeterministicReply('records_empty', locale),
    toolsUsed: ['query_patient_records'],
    endCall: false,
    outcome: GATE_OUTCOME.HANDLED
  };
}

module.exports = { runDeterministicRecords };
