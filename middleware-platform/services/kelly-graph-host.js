'use strict';

const { KELLY_BRANCH } = require('./kelly-conversation-graph');
const KellyOrchestratorPhase = require('./kelly-orchestrator-phase');

const PHASE = KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE;

/**
 * Build graphHost for KellyAgentService.processTurn from LangGraph route (Phases 2–5 hybrid).
 * @param {object} route — { active_branch, branch_step, last_user_message }
 * @param {string} message
 */
function buildGraphHostFromRoute(route, message = '') {
  const branch = String(route?.active_branch || '');
  const step = String(route?.branch_step || '');
  const msg = String(message || route?.last_user_message || '').toLowerCase();
  const payNow = /\b(pay (the )?copay|pay now|send (me )?(a )?(secure )?payment link|pay before)\b/i.test(
    msg
  );

  const host = {
    active_branch: branch,
    branch_step: step,
    clinicalIntake: branch === KELLY_BRANCH.CLINICAL_INTAKE,
    paymentLine: branch === KELLY_BRANCH.PAYMENT_LINE,
    skincareEducation: branch === KELLY_BRANCH.SKINCARE_EDUCATION,
    consult: branch === KELLY_BRANCH.CONSULT,
    support: branch === KELLY_BRANCH.SUPPORT,
    skipStep1: branch === KELLY_BRANCH.CLINICAL_INTAKE,
    payGuardrail: branch === KELLY_BRANCH.PAYMENT_LINE || payNow,
    supportFaqOnly: branch === KELLY_BRANCH.SUPPORT && !payNow,
    forcedPhase: null
  };

  if (branch === KELLY_BRANCH.CLINICAL_INTAKE) {
    if (step === 'schedule_v' || KellyOrchestratorPhase.isRescheduleCancelIntent(msg)) {
      host.forcedPhase = PHASE.BOOKING;
    } else if (step === 'triage') {
      host.forcedPhase = PHASE.TRIAGE_ACTIVE;
    } else {
      host.forcedPhase = PHASE.TRIAGE_DISCOVERY;
    }
  } else if (branch === KELLY_BRANCH.PAYMENT_LINE) {
    host.forcedPhase = PHASE.BILLING;
    if (step === 'send_link' || step === 'payment_start' || payNow) {
      host.payGuardrail = true;
    }
  } else if (branch === KELLY_BRANCH.SKINCARE_EDUCATION) {
    host.forcedPhase = PHASE.ROUTINE_INTAKE;
  } else if (branch === KELLY_BRANCH.CONSULT) {
    host.forcedPhase = PHASE.TRIAGE_ACTIVE;
  } else if (branch === KELLY_BRANCH.SUPPORT) {
    host.forcedPhase = PHASE.BILLING;
  }

  return host;
}

module.exports = { buildGraphHostFromRoute };
