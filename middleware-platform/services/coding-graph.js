/**
 * CODING GRAPH (Section 26 - LangGraph state flow)
 *
 * LangGraph state machine for medical coding voice agent.
 * States: INTAKE → EXTRACTION → TRIAGE → CODING → VALIDATION → BILLING
 *
 * Integrates with LangSmith for tracing. Dual-writes to voice_call_states.
 * Phased rollout: LANGGRAPH_ROLLOUT_PCT env (0=off, 0.1=10%, 1=100%).
 */

require('../utils/langsmith-config');
const { computeNextStage, STAGES } = require('./coding-state-service');
const { buildPerceptualState } = require('./perception-layer');

let graphModule = null;
let compiledGraph = null;
let checkpointer = null;

const ROLLOUT_PCT = parseFloat(process.env.LANGGRAPH_ROLLOUT_PCT || '0');
const SHADOW_MODE = process.env.LANGGRAPH_SHADOW === 'true' || process.env.LANGGRAPH_SHADOW === '1';

async function loadLangGraph() {
  if (graphModule) return graphModule;
  try {
    graphModule = await import('@langchain/langgraph');
    return graphModule;
  } catch (e) {
    console.warn('⚠️  LangGraph not available:', e.message);
    return null;
  }
}

async function getCheckpointer() {
  const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  const usePostgres = connStr && (process.env.NODE_ENV === 'production' || process.env.LANGGRAPH_USE_POSTGRES === 'true');
  if (usePostgres) {
    try {
      const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
      const cp = PostgresSaver.fromConnString(connStr, {
        schema: process.env.LANGGRAPH_CHECKPOINT_SCHEMA || 'public'
      });
      await cp.setup();
      console.log('✅ LangGraph checkpointer: PostgresSaver (production)');
      return cp;
    } catch (e) {
      console.warn('⚠️  PostgresSaver init failed, using MemorySaver:', e.message);
    }
  }
  const LG = await loadLangGraph();
  return LG ? new LG.MemorySaver() : null;
}

async function getGraph(db) {
  if (compiledGraph) return compiledGraph;
  const LG = await loadLangGraph();
  if (!LG) return null;

  const { StateGraph, Annotation, START, END, MemorySaver } = LG;
  checkpointer = await getCheckpointer();
  if (!checkpointer) checkpointer = new MemorySaver();

  const CodingStateAnnotation = Annotation.Root({
    current_stage: Annotation(),
    state_data: Annotation(),
    perceptual_state: Annotation(),
    clinic_id: Annotation(),
    last_trigger: Annotation(),
    last_trigger_reason: Annotation(),
    from_stage: Annotation(),
    transition: Annotation()
  });

  const workflow = new StateGraph(CodingStateAnnotation)
    .addNode('perceive', async (state) => {
      const stateData = state.state_data || {};
      const triggerPayload = stateData.triggerPayload || {};
      const clinicalText = stateData.clinical_text || triggerPayload.transcript || triggerPayload.clinical_note || '';
      const imagePath = stateData.image_path || triggerPayload.image_path || null;
      const existingPerceptual = state.perceptual_state;

      if (!clinicalText && !imagePath) {
        return { perceptual_state: existingPerceptual };
      }
      if (existingPerceptual && existingPerceptual.textual_findings?.length > 0) {
        return { perceptual_state: existingPerceptual };
      }

      try {
        const perceptualState = await buildPerceptualState({
          callId: state.clinic_id ? `call_${state.clinic_id}` : 'graph',
          clinicalText: clinicalText || '',
          imagePath: imagePath || undefined,
          modality: imagePath ? 'xray' : 'text'
        });
        return {
          perceptual_state: perceptualState,
          state_data: { ...stateData, perceptual_state: perceptualState }
        };
      } catch (e) {
        console.warn('[coding-graph] perceive node failed:', e.message);
        return { perceptual_state: existingPerceptual };
      }
    })
    .addNode('apply_trigger', (state) => {
      const currentStage = state.current_stage || 'INTAKE';
      const triggerType = state.last_trigger || 'transcript';
      const triggerPayload = (state.state_data || {}).triggerPayload || {};

      const { nextStage, transition, reason } = computeNextStage(
        currentStage,
        triggerType,
        triggerPayload
      );

      const stateData = {
        ...(state.state_data || {}),
        last_trigger: triggerType,
        last_trigger_reason: reason,
        last_trigger_at: new Date().toISOString()
      };
      if (triggerType === 'function_call') {
        stateData.last_function = triggerPayload.function_name || triggerPayload.functionName;
        stateData.last_result = triggerPayload.result;
      }
      if (state.perceptual_state) {
        stateData.perceptual_state = state.perceptual_state;
      }

      return {
        current_stage: nextStage,
        state_data: stateData,
        perceptual_state: state.perceptual_state,
        from_stage: currentStage,
        transition,
        last_trigger_reason: reason
      };
    })
    .addEdge(START, 'perceive')
    .addEdge('perceive', 'apply_trigger')
    .addEdge('apply_trigger', END);

  compiledGraph = workflow.compile({ checkpointer });
  return compiledGraph;
}

/**
 * Process a turn through LangGraph (Section 26).
 * @param {object} db - Database module
 * @param {string} callId - Call ID (used as thread_id)
 * @param {string} triggerType - 'transcript' | 'function_call'
 * @param {object} triggerPayload - Trigger data
 * @param {object} options - { clinic_id }
 * @returns {{ state, transition, fromStage, toStage } | null} Result or null if LangGraph unavailable
 */
async function processTurn(db, callId, triggerType, triggerPayload = {}, options = {}) {
  if (ROLLOUT_PCT <= 0 && !SHADOW_MODE) return null;

  const graph = await getGraph(db);
  if (!graph) return null;

  const threadId = callId;
  const config = {
    configurable: { thread_id: threadId },
    runName: `coding_state_${triggerType}`,
    tags: ['coding-graph', 'doctor-little', triggerType],
    metadata: { callId, clinic_id: options.clinic_id ?? null }
  };

  const currentState = db?.getCallState?.(callId) || null;
  const currentStage = currentState?.current_stage || 'INTAKE';
  const stateData = { ...(currentState?.state_data || {}), triggerPayload };

  const input = {
    current_stage: currentStage,
    state_data: stateData,
    clinic_id: options.clinic_id ?? currentState?.clinic_id ?? null,
    last_trigger: triggerType
  };
  if (stateData?.perceptual_state) {
    input.perceptual_state = stateData.perceptual_state;
  }

  try {
    const result = await graph.invoke(input, config);
    const toStage = result?.current_stage || currentStage;
    const transition = result?.transition ?? (toStage !== currentStage);

    if (transition && db?.saveAgentStateSnapshot) {
      try {
        db.saveAgentStateSnapshot(callId, `langgraph_${currentStage}_to_${toStage}`, {
          trigger: triggerType,
          reason: result?.last_trigger_reason,
          from: currentStage,
          to: toStage,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        console.warn('⚠️  LangGraph snapshot failed:', e.message);
      }
    }

    if (db?.upsertCallState && (ROLLOUT_PCT >= 1 || SHADOW_MODE)) {
      try {
        db.upsertCallState(callId, {
          clinic_id: options.clinic_id ?? currentState?.clinic_id,
          current_stage: toStage,
          state_data: result?.state_data || stateData
        });
      } catch (e) {
        console.warn('⚠️  LangGraph dual-write failed:', e.message);
      }
    }

    return {
      state: result,
      transition,
      fromStage: currentStage,
      toStage
    };
  } catch (e) {
    console.warn('⚠️  LangGraph invoke failed:', e.message);
    return null;
  }
}

/**
 * Should use LangGraph for this call? (P2: feature flag + rollout %)
 * Checks langgraph_enabled (DB/env) first; then LANGGRAPH_ROLLOUT_PCT.
 */
function shouldUseLangGraph(callId, clinicId = null) {
  try {
    const featureFlags = require('../utils/feature-flags');
    if (!featureFlags.isEnabled('langgraph_enabled', clinicId, callId)) return false;
  } catch (_) {}
  if (ROLLOUT_PCT <= 0) return false;
  if (ROLLOUT_PCT >= 1) return true;
  const hash = hashCallId(callId);
  return (hash % 100) < ROLLOUT_PCT * 100;
}

function hashCallId(id) {
  let h = 0;
  for (let i = 0; i < (id || '').length; i++) {
    h = ((h << 5) - h) + id.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

module.exports = {
  processTurn,
  shouldUseLangGraph,
  STAGES,
  getRolloutPct: () => ROLLOUT_PCT,
  isShadowMode: () => SHADOW_MODE
};
