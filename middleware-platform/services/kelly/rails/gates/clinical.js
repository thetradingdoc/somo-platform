'use strict';

const { KELLY_LANE } = require('../state-schema');
const { sessionRow, opqrstComplete } = require('./shared');

async function runDeterministicClinicalIntro(state, ctx) {
  if (state.active_lane !== KELLY_LANE.CLINICAL || state.step !== 'clinical_intake') return null;
  const msg = String(ctx.message || '').toLowerCase();
  if (!/rash|leg|neck|dermat|itch|skin/.test(msg)) return null;
  const row = sessionRow(ctx.sessionId);
  if (opqrstComplete(row)) return null;
  return {
    reply:
      'I can help with the rash on your leg and neck. A few quick questions will help us line up a dermatology visit — you said this is not an emergency, correct?',
    toolsUsed: [],
    endCall: false
  };
}

module.exports = { runDeterministicClinicalIntro };
