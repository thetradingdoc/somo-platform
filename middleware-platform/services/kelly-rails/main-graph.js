'use strict';

require('../../utils/langsmith-config');

const { executeTurn } = require('./execute-turn');
const { normalizeState } = require('./state-schema');
const { isKellyRailsV2Enabled } = require('./config');

let graphModule = null;
let compiledGraph = null;
let checkpointer = null;

async function loadLangGraph() {
  if (graphModule) return graphModule;
  try {
    graphModule = await import('@langchain/langgraph');
    return graphModule;
  } catch (e) {
    console.warn('[kelly-rails] LangGraph not available:', e.message);
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
      console.warn('[kelly-rails] PostgresSaver failed:', e.message);
    }
  }
  const LG = await loadLangGraph();
  return LG ? new LG.MemorySaver() : null;
}

async function getMainGraph() {
  if (compiledGraph) return compiledGraph;
  const LG = await loadLangGraph();
  if (!LG) return null;

  const { StateGraph, Annotation, START, END, MemorySaver } = LG;
  checkpointer = await getCheckpointer();
  if (!checkpointer) checkpointer = new MemorySaver();

  const KellyRailsAnnotation = Annotation.Root({
    session_id: Annotation(),
    clinic_id: Annotation(),
    patient_id: Annotation(),
    channel: Annotation(),
    active_lane: Annotation(),
    step: Annotation(),
    flags: Annotation(),
    last_user_message: Annotation(),
    last_reply: Annotation(),
    tools_used_last_turn: Annotation(),
    v2_hydrated: Annotation(),
    turn_context: Annotation()
  });

  const workflow = new StateGraph(KellyRailsAnnotation)
    .addNode('execute_turn', async (state) => {
      const ctx = state.turn_context || {};
      const { state: nextState, reply, toolsUsed, endCall } = await executeTurn({
        ...state,
        message: ctx.message || state.last_user_message,
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        callerPhone: ctx.callerPhone
      });
      return {
        ...nextState,
        last_reply: reply,
        tools_used_last_turn: toolsUsed,
        turn_end_call: endCall
      };
    })
    .addEdge(START, 'execute_turn')
    .addEdge('execute_turn', END);

  compiledGraph = workflow.compile({ checkpointer });
  return compiledGraph;
}

/**
 * Invoke Kelly Main Graph for one patient message.
 */
async function invokeMainGraph(opts = {}) {
  if (!isKellyRailsV2Enabled()) return null;

  const sessionId = String(opts.sessionId || '').trim();
  if (!sessionId) return null;

  const graph = await getMainGraph();
  if (!graph) {
    const direct = await executeTurn({
      session_id: sessionId,
      clinic_id: opts.clinicId,
      patient_id: opts.patientId,
      channel: opts.channel || 'chat',
      message: opts.message,
      clinicId: opts.clinicId,
      patientId: opts.patientId,
      callerPhone: opts.callerPhone,
      locale: opts.locale || opts.preferredLanguage,
      preferredLanguage: opts.preferredLanguage || opts.locale
    });
    return direct;
  }

  const laneHint = String(opts.message || '').slice(0, 40);
  const config = {
    configurable: { thread_id: sessionId },
    runName: `kelly_rails_v2_${laneHint}`,
    tags: ['kelly-rails-v2', opts.channel || 'chat'],
    metadata: { session_id: sessionId, clinic_id: opts.clinicId || null }
  };

  const db = require('../../database');
  let locale = opts.locale || opts.preferredLanguage;
  if (!locale && sessionId && db.getKellySessionLanguage) {
    locale = db.getKellySessionLanguage(sessionId);
  }
  locale = String(locale || 'en').slice(0, 2);

  const input = {
    session_id: sessionId,
    clinic_id: opts.clinicId || null,
    patient_id: opts.patientId || null,
    channel: opts.channel || 'chat',
    locale,
    preferredLanguage: locale,
    last_user_message: String(opts.message || ''),
    turn_context: {
      message: opts.message,
      clinicId: opts.clinicId,
      patientId: opts.patientId,
      callerPhone: opts.callerPhone,
      locale
    }
  };

  try {
    const result = await graph.invoke(input, config);
    return {
      state: normalizeState(result),
      reply: result.last_reply || '',
      toolsUsed: result.tools_used_last_turn || [],
      endCall: !!result.turn_end_call
    };
  } catch (e) {
    console.warn('[kelly-rails] graph invoke failed:', e.message);
    return executeTurn({
      session_id: sessionId,
      message: opts.message,
      clinicId: opts.clinicId,
      patientId: opts.patientId,
      callerPhone: opts.callerPhone,
      channel: opts.channel,
      locale: opts.locale || opts.preferredLanguage,
      preferredLanguage: opts.preferredLanguage || opts.locale
    });
  }
}

module.exports = { getMainGraph, invokeMainGraph };
