'use strict';

const { KELLY_LANE } = require('./state-schema');
const { hasSymptomEvidence } = require('../../conversation/intent-detector');

function hasText(v) {
  return v != null && String(v).trim().length > 0;
}

function hasSymptomFieldsInTriage(row) {
  if (!row) return false;
  return (
    hasText(row.onset) ||
    hasText(row.quality) ||
    hasText(row.region) ||
    hasText(row.body_site) ||
    (row.severity != null && row.severity !== '')
  );
}

/**
 * L-3: Clinical lane requires symptom evidence or populated triage symptom fields.
 */
function canEnterClinicalLane({
  message = '',
  triageRow = null,
  conversationMode = null,
  activeSubrail = null
} = {}) {
  if (hasSymptomFieldsInTriage(triageRow)) return true;
  if (hasSymptomEvidence(message)) return true;
  if (conversationMode === 'tenant_inbound_clinical' && activeSubrail === 'opqrst') {
    return hasSymptomEvidence(message) || hasSymptomFieldsInTriage(triageRow);
  }
  return false;
}

/** Downgrade clinical route when preconditions fail. */
function guardClinicalRoute(route, ctx = {}) {
  if (!route || route.lane !== KELLY_LANE.CLINICAL) return route;
  if (
    canEnterClinicalLane({
      message: ctx.message,
      triageRow: ctx.triageRow,
      conversationMode: ctx.conversationMode,
      activeSubrail: ctx.activeSubrail
    })
  ) {
    return route;
  }
  const msg = String(ctx.message || '').toLowerCase();
  if (/book|schedule|appointment|booking/.test(msg)) {
    return { lane: KELLY_LANE.BOOKING, step: 'schedule_visit' };
  }
  return { lane: KELLY_LANE.BASIC_INTAKE, step: 'identity' };
}

module.exports = {
  canEnterClinicalLane,
  guardClinicalRoute,
  hasSymptomFieldsInTriage
};
