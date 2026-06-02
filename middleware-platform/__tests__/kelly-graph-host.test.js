'use strict';

const { KELLY_BRANCH } = require('../services/kelly-conversation-graph');
const { buildGraphHostFromRoute } = require('../services/kelly-graph-host');
const KellyOrchestratorPhase = require('../services/kelly-orchestrator-phase');

describe('kelly-graph-host buildGraphHostFromRoute', () => {
  test('clinical start_intake forces TRIAGE_DISCOVERY', () => {
    const host = buildGraphHostFromRoute({
      active_branch: KELLY_BRANCH.CLINICAL_INTAKE,
      branch_step: 'verify_patient'
    });
    expect(host.clinicalIntake).toBe(true);
    expect(host.skipStep1).toBe(true);
    expect(host.forcedPhase).toBe(KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY);
  });

  test('payment_line enables pay guardrail', () => {
    const host = buildGraphHostFromRoute({
      active_branch: KELLY_BRANCH.PAYMENT_LINE,
      branch_step: 'payment_start'
    });
    expect(host.paymentLine).toBe(true);
    expect(host.payGuardrail).toBe(true);
    expect(host.forcedPhase).toBe(KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.BILLING);
  });

  test('reschedule message maps to BOOKING at schedule_v', () => {
    const host = buildGraphHostFromRoute(
      {
        active_branch: KELLY_BRANCH.CLINICAL_INTAKE,
        branch_step: 'schedule_v'
      },
      'please reschedule my appointment'
    );
    expect(host.forcedPhase).toBe(KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.BOOKING);
  });

  test('skincare education forces ROUTINE_INTAKE', () => {
    const host = buildGraphHostFromRoute({
      active_branch: KELLY_BRANCH.SKINCARE_EDUCATION,
      branch_step: 'routine_intake'
    });
    expect(host.forcedPhase).toBe(KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE);
  });
});
