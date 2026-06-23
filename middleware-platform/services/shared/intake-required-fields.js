const PATHWAYS = {
  triage: ['chief_complaint', 'body_sites', 'severity', 'timeline'],
  routine: ['chief_complaint'],
  video: ['chief_complaint', 'severity']
};

function getRequiredFieldsSchema() {
  return {
    triage: {
      minimum_required: PATHWAYS.triage,
      hard_blockers: ['chief_complaint']
    },
    routine: {
      minimum_required: PATHWAYS.routine,
      hard_blockers: []
    },
    video: {
      minimum_required: PATHWAYS.video,
      hard_blockers: ['chief_complaint']
    }
  };
}

function _hasField(state, key) {
  if (!state) return false;
  if (key === 'body_sites') return Array.isArray(state.body_sites) && state.body_sites.length > 0;
  if (key === 'risk_flags') return Array.isArray(state.risk_flags) && state.risk_flags.length > 0;
  const v = state[key];
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

function evaluateRequiredFields(pathway, state) {
  const schema = getRequiredFieldsSchema();
  const selected = schema[pathway] || schema.triage;
  const missingRequired = selected.minimum_required.filter((f) => !_hasField(state, f));
  const hardBlockers = selected.hard_blockers.filter((f) => !_hasField(state, f));
  return {
    pathway: schema[pathway] ? pathway : 'triage',
    missing_required: missingRequired,
    hard_blockers: hardBlockers,
    is_minimum_met: missingRequired.length === 0
  };
}

function nextRequiredField(pathway, state) {
  const gate = evaluateRequiredFields(pathway, state);
  if (gate.hard_blockers.length) return gate.hard_blockers[0];
  return gate.missing_required[0] || null;
}

module.exports = {
  getRequiredFieldsSchema,
  evaluateRequiredFields,
  nextRequiredField
};
