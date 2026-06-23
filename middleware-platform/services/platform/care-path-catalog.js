function _arr(v) {
  return Array.isArray(v) ? v : [];
}

const CATALOG = [
  {
    id: 'emergency_escalation',
    when: (ctx) => String(ctx.safety_status || '').toLowerCase() === 'red',
    route: 'doctor_needed',
    suppress_commercial: true,
    recommendation: 'Escalate to emergency instructions and in-person urgent care.'
  },
  {
    id: 'urgent_doctor_path',
    when: (ctx) => ['urgent', 'emergent'].includes(String(ctx.urgency || '').toLowerCase()),
    route: 'doctor_needed',
    suppress_commercial: true,
    recommendation: 'Prioritize specialist/doctor booking path.'
  },
  {
    id: 'evidence_qna_path',
    when: (ctx) => String(ctx.intent || '').toLowerCase() === 'evidence_question',
    route: 'evidence_question',
    suppress_commercial: false,
    recommendation: 'Route to literature evidence response.'
  },
  {
    id: 'records_qna_path',
    when: (ctx) => String(ctx.intent || '').toLowerCase() === 'records_question',
    route: 'records_question',
    suppress_commercial: false,
    recommendation: 'Route to patient records explanation.'
  },
  {
    id: 'routine_care_guidance',
    when: (ctx) => true,
    route: 'care_guidance',
    suppress_commercial: false,
    recommendation: 'Provide conservative care guidance and optional follow-up.'
  }
];

function resolveCarePath(context = {}) {
  const ctx = {
    ...context,
    risk_flags: _arr(context.risk_flags)
  };
  const selected = CATALOG.find((c) => c.when(ctx)) || CATALOG[CATALOG.length - 1];
  return {
    path_id: selected.id,
    route: selected.route,
    suppress_commercial: !!selected.suppress_commercial,
    recommendation: selected.recommendation
  };
}

module.exports = {
  resolveCarePath
};
