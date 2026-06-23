/**
 * Hybrid LangGraph host (Phases 2–7): graph routes branch/step, KellyAgentService.processTurn executes with graphHost.
 * When KELLY_RAILS_V2=1, kelly-turn-resolver uses kelly-rails orchestrator instead.
 */

'use strict';

const KellyConversationGraph = require('./kelly-conversation-graph');
const { KELLY_BRANCH } = KellyConversationGraph;
const { buildGraphHostFromRoute } = require('./kelly-graph-host');

function _metaBool(sessionId, key) {
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    const v = String(KellyToolExecutor._getSessionMeta(sessionId, key) || '').toLowerCase();
    return v === '1' || v === 'true';
  } catch (_) {
    return false;
  }
}

function loadGraphFlags(sessionId) {
  const db = require('../../database');
  const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
  const hasRag = !!(sessionRow && sessionRow.rag_result_id);
  return {
    routine_intake_active: _metaBool(sessionId, 'routine_intake_active'),
    triage_complete: !!(sessionRow && (sessionRow.triage_complete === 1 || sessionRow.triage_complete === true)),
    has_rag: hasRag,
    booking_intent_seen: _metaBool(sessionId, 'booking_intent_seen')
  };
}

function applyGraphRouteMeta(sessionId, route) {
  if (!sessionId || !route) return;
  const KellyToolExecutor = require('./kelly-tool-executor');
  try {
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_graph_active', '1');
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_graph_branch', String(route.active_branch || ''));
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_graph_step', String(route.branch_step || ''));

    if (route.active_branch === KELLY_BRANCH.SKINCARE_EDUCATION) {
      KellyToolExecutor._setSessionMeta(sessionId, 'routine_intake_active', '1');
    }
    if (route.active_branch === KELLY_BRANCH.CLINICAL_INTAKE) {
      KellyToolExecutor._setSessionMeta(sessionId, 'routine_intake_active', '0');
      const msg = String(route.last_user_message || '').toLowerCase();
      const KellyOrchestratorPhase = require('./kelly-orchestrator-phase');
      if (KellyOrchestratorPhase.isRescheduleCancelIntent(msg)) {
        KellyToolExecutor._setSessionMeta(sessionId, 'booking_mode', 'reschedule');
        route.branch_step = 'schedule_v';
        KellyToolExecutor._setSessionMeta(sessionId, 'kelly_graph_step', 'schedule_v');
      }
    }
    if (route.active_branch === KELLY_BRANCH.CONSULT) {
      KellyToolExecutor._setSessionMeta(sessionId, 'kelly_consult_intent', '1');
    }
    if (route.active_branch === KELLY_BRANCH.SUPPORT) {
      KellyToolExecutor._setSessionMeta(sessionId, 'kelly_support_intent', '1');
    }
  } catch (_) {}
}

/** P3-1–4 / I2-1–3: advance branch_step after a successful turn. */
function advanceGraphStepAfterTurn(sessionId, graphRoute, result) {
  if (!sessionId || !graphRoute) return graphRoute;
  const KellyToolExecutor = require('./kelly-tool-executor');
  let step = String(graphRoute.branch_step || '');
  const branch = graphRoute.active_branch;

  if (branch === KELLY_BRANCH.PAYMENT_LINE) {
    const tools = (result?.toolsUsed || []).map((t) => String(t).toLowerCase());
    const sentLink = tools.some((t) => t.includes('request_patient_payment'));
    const token =
      KellyToolExecutor._getSessionMeta(sessionId, 'rcm_pay_token') ||
      KellyToolExecutor._getSessionMeta(sessionId, 'payment_token');
    if (step === 'payment_start' && sentLink) step = 'send_link';
    else if (step === 'send_link' && token) step = 'verify_pay';
    else if (step === 'verify_pay' && token) step = 'finish_pay';
  }

  if (branch === KELLY_BRANCH.CLINICAL_INTAKE) {
    const db = require('../../database');
    const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
    const KellyOrchestratorPhase = require('./kelly-orchestrator-phase');
    const flags = loadGraphFlags(sessionId);
    if (step === 'start_intake' && sessionRow?.patient_id) step = 'verify_patient';
    if (
      (step === 'verify_patient' || step === 'start_intake') &&
      KellyOrchestratorPhase.clinicMinimumIntakeMet({
        sessionRow,
        metaGet: (k) => KellyToolExecutor._getSessionMeta(sessionId, k)
      })
    ) {
      step = 'triage';
    }
    if (flags.triage_complete && (flags.booking_intent_seen || flags.has_rag)) {
      step = 'schedule_v';
    }
  }

  if (step && step !== graphRoute.branch_step) {
    graphRoute.branch_step = step;
    try {
      KellyToolExecutor._setSessionMeta(sessionId, 'kelly_graph_step', step);
    } catch (_) {}
  }
  return graphRoute;
}

/**
 * Single Kelly turn entry for voice + patient chat (W5).
 * @param {object} opts — same shape as KellyAgentService.processTurn
 */
async function runKellyConversationTurn(opts = {}) {
  const sessionId = String(opts.sessionId || '').trim();
  const useGraph =
    sessionId && KellyConversationGraph.shouldUseKellyGraph(sessionId, opts.clinicId || null);

  let graphRoute = null;
  let graphHost = null;
  if (useGraph) {
    const flags = loadGraphFlags(sessionId);
    graphRoute = await KellyConversationGraph.processTurn({
      sessionId,
      clinicId: opts.clinicId || null,
      patientId: opts.patientId || null,
      channel: opts.channel || 'chat',
      message: opts.message || '',
      flags
    });
    if (graphRoute) {
      graphRoute.last_user_message = String(opts.message || '');
      applyGraphRouteMeta(sessionId, graphRoute);
      graphHost = buildGraphHostFromRoute(graphRoute, opts.message);
      if (graphHost.forcedPhase) {
        try {
          const KellyToolExecutor = require('./kelly-tool-executor');
          KellyToolExecutor._setSessionMeta(sessionId, 'kelly_orchestrator_phase', graphHost.forcedPhase);
        } catch (_) {}
      }
    }
  }

  const KellyAgentService = require('./kelly-agent-service');
  const result = await KellyAgentService.processTurn({ ...opts, graphHost });
  if (graphRoute) {
    graphRoute = advanceGraphStepAfterTurn(sessionId, graphRoute, result);
  }
  if (graphRoute && result && typeof result === 'object') {
    result.kelly_graph = {
      active_branch: graphRoute.active_branch,
      branch_step: graphRoute.branch_step
    };
    if (graphHost) result.graphHost = graphHost;
  }
  return result;
}

module.exports = {
  runKellyConversationTurn,
  loadGraphFlags,
  applyGraphRouteMeta,
  buildGraphHostFromRoute
};
