'use strict';

/**
 * Maps Kelly Rails lane → legacy orchestrator phase enum (single definition).
 * @see services/kelly-orchestrator-phase.js KELLY_ORCHESTRATOR_PHASE
 */
function laneToOrchestratorPhase(lane) {
  const map = {
    clinical: 'TRIAGE_ACTIVE',
    booking: 'BOOKING',
    payment: 'BILLING',
    basic_intake: 'TRIAGE_DISCOVERY',
    education: 'ROUTINE_INTAKE',
    support: 'BILLING',
    account: 'BILLING',
    records: 'BILLING',
    reschedule: 'BOOKING'
  };
  return map[String(lane || '').toLowerCase()] || 'TRIAGE_DISCOVERY';
}

module.exports = { laneToOrchestratorPhase };
