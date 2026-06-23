/**
 * Kelly conversation graph — LangGraph host for patient-facing rails.
 *
 * Branches: clinical_intake, payment_line, skincare_education, consult, support.
 * Mirrors rollout pattern from coding-graph.js (LANGGRAPH_KELLY_ROLLOUT_PCT).
 *
 * Phase 1: router skeleton + routeIntakeSwitch. Subgraphs wired in Phase 2–5.
 * Fallback: KellyAgentService.processTurn when graph off or invoke fails.
 */

'use strict';

require('../../utils/langsmith-config');

const KELLY_BRANCH = {
  ROUTER: 'router',
  CLINICAL_INTAKE: 'clinical_intake',
  PAYMENT_LINE: 'payment_line',
  SKINCARE_EDUCATION: 'skincare_education',
  CONSULT: 'consult',
  SUPPORT: 'support',
  UNKNOWN: 'unknown'
};

const CLINICAL_SIGNALS = [
  'see a doctor',
  'see a dermatolog',
  'appointment',
  'book',
  'visit',
  'clinic',
  'rash',
  'itch',
  'pain',
  'symptom',
  'fever',
  'pelvic',
  'gynecolog',
  'obgyn',
  'ob/gyn',
  'period',
  'dermatolog',
  'skin concern',
  'not an emergency'
];

const PAYMENT_SIGNALS = [
  'pay my copay',
  'pay the copay',
  'pay now',
  'payment link',
  'secure payment',
  'pay before',
  'send me a link',
  'pay $',
  'copay now'
];

const BILLING_FAQ_SIGNALS = ['receipt', 'claim status', 'refund', 'deductible', 'member id'];

const RECORDS_SIGNALS = ['last visit', 'my records', 'medical history', 'what did my doctor'];

let graphModule = null;
let compiledGraph = null;
let checkpointer = null;

let ROLLOUT_PCT = parseFloat(process.env.LANGGRAPH_KELLY_ROLLOUT_PCT || '0');
const SHADOW_MODE =
  process.env.LANGGRAPH_KELLY_SHADOW === 'true' || process.env.LANGGRAPH_KELLY_SHADOW === '1';

if (process.env.NODE_ENV === 'production') {
  const pct = Number.isFinite(ROLLOUT_PCT) ? ROLLOUT_PCT : 0;
  if (pct > 0 && pct < 1) {
    throw new Error(
      `LANGGRAPH_KELLY_ROLLOUT_PCT must be 0 or 1 in production (got ${process.env.LANGGRAPH_KELLY_ROLLOUT_PCT})`
    );
  }
  ROLLOUT_PCT = pct;
}

/**
 * Route first-line intent to a Kelly branch (G1-2).
 * @param {object} state
 * @param {string} [state.last_user_message]
 * @param {object} [state.flags]
 * @returns {string} KELLY_BRANCH value
 */
function routeIntakeSwitch(state = {}) {
  const msg = String(state.last_user_message || '').toLowerCase();
  const flags = state.flags || {};
  const routineIntake = !!(flags.routine_intake_active);

  if (PAYMENT_SIGNALS.some((s) => msg.includes(s))) {
    return KELLY_BRANCH.PAYMENT_LINE;
  }

  if (BILLING_FAQ_SIGNALS.some((s) => msg.includes(s))) {
    return KELLY_BRANCH.SUPPORT;
  }

  if (RECORDS_SIGNALS.some((s) => msg.includes(s))) {
    return KELLY_BRANCH.CONSULT;
  }

  try {
    const KellyOrchestratorPhase = require('./kelly-orchestrator-phase');
    if (KellyOrchestratorPhase.isRescheduleCancelIntent(msg)) {
      return KELLY_BRANCH.CLINICAL_INTAKE;
    }
  } catch (_) {}

  const clinicalHit = CLINICAL_SIGNALS.some((s) => msg.includes(s));
  if (clinicalHit && !routineIntake) {
    return KELLY_BRANCH.CLINICAL_INTAKE;
  }

  if (routineIntake) {
    return KELLY_BRANCH.SKINCARE_EDUCATION;
  }

  if (clinicalHit) {
    return KELLY_BRANCH.CLINICAL_INTAKE;
  }

  return KELLY_BRANCH.UNKNOWN;
}

async function loadLangGraph() {
  if (graphModule) return graphModule;
  try {
    graphModule = await import('@langchain/langgraph');
    return graphModule;
  } catch (e) {
    console.warn('[kelly-conversation-graph] LangGraph not available:', e.message);
    return null;
  }
}

async function getCheckpointer() {
  const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  const usePostgres =
    connStr && (process.env.NODE_ENV === 'production' || process.env.LANGGRAPH_USE_POSTGRES === 'true');
  if (usePostgres) {
    try {
      const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
      const cp = PostgresSaver.fromConnString(connStr, {
        schema: process.env.LANGGRAPH_CHECKPOINT_SCHEMA || 'public'
      });
      await cp.setup();
      return cp;
    } catch (e) {
      console.warn('[kelly-conversation-graph] PostgresSaver failed, MemorySaver:', e.message);
    }
  }
  const LG = await loadLangGraph();
  return LG ? new LG.MemorySaver() : null;
}

async function getGraph() {
  if (compiledGraph) return compiledGraph;
  const LG = await loadLangGraph();
  if (!LG) return null;

  const { StateGraph, Annotation, START, END, MemorySaver } = LG;
  checkpointer = await getCheckpointer();
  if (!checkpointer) checkpointer = new MemorySaver();

  const KellyStateAnnotation = Annotation.Root({
    session_id: Annotation(),
    clinic_id: Annotation(),
    patient_id: Annotation(),
    channel: Annotation(),
    active_branch: Annotation(),
    branch_step: Annotation(),
    last_user_message: Annotation(),
    flags: Annotation(),
    branch_payload: Annotation()
  });

  function branchEntryNode(branch, step) {
    return () => ({ active_branch: branch, branch_step: step });
  }

  const workflow = new StateGraph(KellyStateAnnotation)
    .addNode('router', (state) => {
      const branch = routeIntakeSwitch(state);
      return { active_branch: branch };
    })
    .addNode('clinical_intake_entry', branchEntryNode(KELLY_BRANCH.CLINICAL_INTAKE, 'start_intake'))
    .addNode('payment_line_entry', branchEntryNode(KELLY_BRANCH.PAYMENT_LINE, 'payment_start'))
    .addNode('skincare_education_entry', branchEntryNode(KELLY_BRANCH.SKINCARE_EDUCATION, 'routine_intake'))
    .addNode('consult_entry', branchEntryNode(KELLY_BRANCH.CONSULT, 'records_qa'))
    .addNode('support_entry', branchEntryNode(KELLY_BRANCH.SUPPORT, 'faq'))
    .addNode('unknown_entry', branchEntryNode(KELLY_BRANCH.UNKNOWN, 'await_intent'))
    .addEdge(START, 'router')
    .addConditionalEdges('router', (state) => state.active_branch || KELLY_BRANCH.UNKNOWN, {
      [KELLY_BRANCH.CLINICAL_INTAKE]: 'clinical_intake_entry',
      [KELLY_BRANCH.PAYMENT_LINE]: 'payment_line_entry',
      [KELLY_BRANCH.SKINCARE_EDUCATION]: 'skincare_education_entry',
      [KELLY_BRANCH.CONSULT]: 'consult_entry',
      [KELLY_BRANCH.SUPPORT]: 'support_entry',
      [KELLY_BRANCH.UNKNOWN]: 'unknown_entry'
    })
    .addEdge('clinical_intake_entry', END)
    .addEdge('payment_line_entry', END)
    .addEdge('skincare_education_entry', END)
    .addEdge('consult_entry', END)
    .addEdge('support_entry', END)
    .addEdge('unknown_entry', END);

  compiledGraph = workflow.compile({ checkpointer });
  return compiledGraph;
}

/**
 * Process one Kelly conversation turn through the graph router (Phase 1).
 * @returns {Promise<{ active_branch, branch_step, flags } | null>}
 */
async function processTurn(opts = {}) {
  if (ROLLOUT_PCT <= 0 && !SHADOW_MODE) return null;

  const sessionId = String(opts.sessionId || '').trim();
  if (!sessionId) return null;

  const graph = await getGraph();
  if (!graph) return null;

  const preRoute = routeIntakeSwitch({
    last_user_message: String(opts.message || ''),
    flags: opts.flags || {}
  });
  const preStep =
    preRoute === KELLY_BRANCH.CLINICAL_INTAKE
      ? 'start_intake'
      : preRoute === KELLY_BRANCH.PAYMENT_LINE
        ? 'payment_start'
        : preRoute === KELLY_BRANCH.SKINCARE_EDUCATION
          ? 'routine_intake'
          : preRoute === KELLY_BRANCH.CONSULT
            ? 'records_qa'
            : preRoute === KELLY_BRANCH.SUPPORT
              ? 'faq'
              : 'await_intent';

  const config = {
    configurable: { thread_id: sessionId },
    runName: `kelly_${preRoute}_${preStep}`,
    tags: ['kelly-conversation-graph', opts.channel || 'unknown'],
    metadata: {
      session_id: sessionId,
      clinic_id: opts.clinicId || null,
      patient_id: opts.patientId || null
    }
  };

  const input = {
    session_id: sessionId,
    clinic_id: opts.clinicId || null,
    patient_id: opts.patientId || null,
    channel: opts.channel || 'chat',
    last_user_message: String(opts.message || ''),
    flags: opts.flags || {},
    branch_payload: opts.branchPayload || {}
  };

  try {
    const result = await graph.invoke(input, config);
    const out = {
      active_branch: result?.active_branch || routeIntakeSwitch(input),
      branch_step: result?.branch_step || 'await_intent',
      flags: result?.flags || input.flags
    };
    if (SHADOW_MODE && ROLLOUT_PCT < 1) {
      console.log('[kelly-conversation-graph] shadow route:', out.active_branch, out.branch_step);
    }
    return out;
  } catch (e) {
    console.warn('[kelly-conversation-graph] invoke failed:', e.message);
    return null;
  }
}

function hashSessionId(id) {
  let h = 0;
  for (let i = 0; i < (id || '').length; i++) {
    h = (h << 5) - h + id.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function shouldUseKellyGraph(sessionId, _clinicId = null) {
  if (process.env.LANGGRAPH_KELLY_ENABLED === '0') return false;
  if (ROLLOUT_PCT <= 0 && !SHADOW_MODE) return false;
  if (ROLLOUT_PCT >= 1 || SHADOW_MODE) return true;
  return hashSessionId(sessionId) % 100 < ROLLOUT_PCT * 100;
}

module.exports = {
  KELLY_BRANCH,
  routeIntakeSwitch,
  processTurn,
  shouldUseKellyGraph,
  getRolloutPct: () => ROLLOUT_PCT,
  isShadowMode: () => SHADOW_MODE
};
