/**
 * Video Consult LangGraph
 * Orchestrates multimodal telehealth: transcript + vision → perceive → RAG → reason → FHIR.
 * Event-driven: full pipeline runs only on end_session.
 * See docs/architecture for VIDEO_CONSULT_ARCHITECTURE.md
 */

const db = require('../database');
const FHIRService = require('./fhir-service');
const tokenBudget = require('../utils/token-budget');
const { retrieveFromColabRAG } = require('./layer2-rag/remote-rag-client');
const reviewTaskService = require('./review-task-service');

const SLOW_NODE_MS = parseInt(process.env.VIDEO_CONSULT_SLOW_NODE_MS || '5000', 10);

let graphModule = null;
let compiledGraph = null;
let checkpointer = null;

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
      const cp = PostgresSaver.fromConnString(connStr, { schema: process.env.LANGGRAPH_CHECKPOINT_SCHEMA || 'public' });
      await cp.setup();
      return cp;
    } catch (e) {
      console.warn('⚠️  PostgresSaver init failed, using MemorySaver:', e.message);
    }
  }
  const LG = await loadLangGraph();
  return LG ? new LG.MemorySaver() : null;
}

/**
 * Process event from LiveKit agents.
 * For transcript/vision: accumulate state.
 * For end_session: run full pipeline (perceive → store FHIR).
 */
async function processEvent(roomId, eventType, payload, options = {}) {
  const LG = await loadLangGraph();
  if (!LG) {
    return { success: false, error: 'LangGraph not available', stage: 'SKIPPED' };
  }

  const { StateGraph, Annotation, START, END, MemorySaver } = LG;
  checkpointer = checkpointer || (await getCheckpointer()) || new MemorySaver();

  const VideoConsultStateAnnotation = Annotation.Root({
    room_id: Annotation({ reducer: (a, b) => b ?? a }),
    session_status: Annotation({ reducer: (a, b) => b ?? a }),
    session_metadata: Annotation({ reducer: (a, b) => (b ? { ...a, ...b } : a) ?? {} }),
    encounter_id: Annotation({ reducer: (a, b) => b ?? a }),
    clinic_id: Annotation({ reducer: (a, b) => b ?? a }),
    patient_id: Annotation({ reducer: (a, b) => b ?? a }),
    patient_name: Annotation({ reducer: (a, b) => b ?? a }),
    provider_id: Annotation({ reducer: (a, b) => b ?? a }),
    event_type: Annotation({ reducer: (a, b) => b ?? a }),
    audio_transcript: Annotation({
      reducer: (prev, next) => {
        const p = Array.isArray(prev) ? prev : [];
        const n = Array.isArray(next) ? next : [next].filter(Boolean);
        return [...p, ...n];
      }
    }),
    video_frames: Annotation({
      reducer: (prev, next) => {
        const p = Array.isArray(prev) ? prev : [];
        const n = Array.isArray(next) ? next : [next].filter(Boolean);
        return [...p, ...n];
      }
    }),
    perceptual_state: Annotation({ reducer: (a, b) => b ?? a }),
    rag_context: Annotation({ reducer: (a, b) => b ?? a }),
    current_stage: Annotation({ reducer: (a, b) => b ?? a }),
    requires_human_review: Annotation({ reducer: (a, b) => b ?? a }),
    error: Annotation({ reducer: (a, b) => b ?? a })
  });

  function withTelemetry(nodeName, fn) {
    return async (state) => {
      const start = Date.now();
      try {
        const out = await fn(state);
        const ms = Date.now() - start;
        if (ms > SLOW_NODE_MS) {
          console.warn(`[video-consult] ⚠️  Slow node: ${nodeName} took ${ms}ms (threshold: ${SLOW_NODE_MS}ms)`);
        }
        return { ...out, processing_metadata: { ...(out.processing_metadata || {}), [`${nodeName}_ms`]: ms } };
      } catch (e) {
        console.warn(`[video-consult] node ${nodeName} error after ${Date.now() - start}ms:`, e.message);
        throw e;
      }
    };
  }

  async function retrieveContextNode(state) {
    try {
      const transcript = state.audio_transcript || [];
      const text = transcript
        .map(t => (typeof t === 'string' ? t : (t.text || t.content || '')))
        .filter(Boolean)
        .join(' ')
        .slice(0, 2000);
      if (!text.trim()) {
        return { rag_context: { icd10: [], cpt: [], hcpcs: [] }, current_stage: 'RAG_SKIPPED_NO_TEXT' };
      }
      const result = await retrieveFromColabRAG({
        query: text,
        specialty: state.perceptual_state?.specialty_tag || 'general',
        top_k: 10
      });
      if (!result) {
        return { rag_context: { icd10: [], cpt: [], hcpcs: [] }, current_stage: 'RAG_FALLBACK_EMPTY' };
      }
      return {
        rag_context: {
          icd10: result.icd10 || [],
          cpt: result.cpt || [],
          hcpcs: result.hcpcs || []
        },
        current_stage: 'RAG_COMPLETE'
      };
    } catch (err) {
      console.warn('[video-consult-graph] retrieveContextNode error (continuing without RAG):', err.message);
      return {
        rag_context: { icd10: [], cpt: [], hcpcs: [] },
        current_stage: 'RAG_ERROR_FALLBACK',
        error: { message: err.message, recoverable: true }
      };
    }
  }

  async function storeFhirNode(state) {
    const startTime = Date.now();
    try {
      if (!tokenBudget.canProceedVideoConsult(state.room_id, 0.05)) {
        return {
          current_stage: 'FHIR_BUDGET_EXCEEDED',
          error: { message: 'Session cost limit exceeded', recoverable: false }
        };
      }
      const transcript = state.audio_transcript || [];
      const messages = transcript.map(t => ({
        text: typeof t === 'string' ? t : (t.text || t.content || ''),
        speaker: t.speaker || 'unknown',
        timestamp: t.timestamp || new Date().toISOString()
      })).filter(m => m.text);

      if (messages.length === 0) {
        return { current_stage: 'FHIR_SKIPPED_NO_TRANSCRIPT', error: null };
      }

      let patientId = state.patient_id || 'unknown';
      let encounterId = state.encounter_id || state.room_id;
      const patientName = state.patient_name || options.patientName || 'Video Consult Patient';

      // Ensure patient exists in FHIR (required for fhir_communications FK)
      const patientExists = patientId && patientId !== 'unknown' && db.getFHIRPatient?.(patientId);
      if (!patientExists) {
        try {
          const patientResult = await FHIRService.getOrCreatePatient({
            name: patientName,
            phone: `+1555${String(Date.now()).slice(-7)}` // Placeholder for video-consult sessions
          }, false);
          const p = patientResult?.patient;
          patientId = p?.id ?? p?.resource_id ?? patientId;
        } catch (e) {
          console.warn('[video-consult-graph] getOrCreatePatient failed:', e.message);
        }
      }

      // Ensure encounter exists (FK required when provided)
      if (encounterId && !db.getFHIREncounter?.(encounterId)) {
        try {
          const enc = await FHIRService.createEncounter({
            patientId,
            patientName,
            callId: state.room_id,
            status: 'finished',
            type: 'Video consultation'
          });
          encounterId = enc?.id ?? enc?.resource_id ?? encounterId;
        } catch (e) {
          console.warn('[video-consult-graph] createEncounter failed, storing without encounter:', e.message);
          encounterId = null; // Omit encounter link
        }
      }

      await FHIRService.storeTranscript({
        patientId,
        patientName,
        encounterId,
        messages,
        sentTime: new Date().toISOString(),
        notes: [{ text: `Video consult transcript (room: ${state.room_id})`, time: new Date().toISOString() }]
      });

      db.insertVideoConsultAiDecision(
        state.room_id, 'store_fhir', { transcript_length: messages.length }, null, 1,
        patientId, 'FHIRService.storeTranscript'
      );

      tokenBudget.addVideoConsultCost(state.room_id, 0.05);

      return {
        current_stage: 'FHIR_COMPLETE',
        error: null,
        processing_metadata: { fhir_ms: Date.now() - startTime }
      };
    } catch (err) {
      console.error('[video-consult-graph] storeFhirNode error:', err);
      return {
        current_stage: 'FHIR_ERROR',
        error: { message: err.message, recoverable: true }
      };
    }
  }

  function accumulateNode(state) {
    try {
      return {}; // State already merged via reducers; this ensures checkpoint is written
    } catch (err) {
      console.error('[video-consult-graph] accumulateNode error:', err);
      return { error: { message: err.message, recoverable: true } };
    }
  }

  function humanReviewNode(state) {
    const needsReview =
      state.current_stage === 'RAG_ERROR_FALLBACK' ||
      (state.current_stage === 'RAG_SKIPPED_NO_TEXT' && (state.audio_transcript || []).length > 0) ||
      (state.current_stage === 'RAG_FALLBACK_EMPTY' && (state.audio_transcript || []).length > 0);
    if (needsReview && state.room_id) {
      try {
        reviewTaskService.createTask({
          room_id: state.room_id,
          severity: state.current_stage === 'RAG_ERROR_FALLBACK' ? 'WARNING' : 'INFO',
          findings: { stage: state.current_stage, transcript_length: (state.audio_transcript || []).length }
        });
      } catch (e) {
        console.warn('[video-consult] humanReviewNode createTask failed:', e.message);
      }
    }
    return { requires_human_review: needsReview };
  }

  function routeByEvent(state) {
    return state.event_type === 'end_session' ? 'retrieve_context' : '__end__';
  }

  const workflow = new StateGraph(VideoConsultStateAnnotation)
    .addNode('accumulate', accumulateNode)
    .addNode('retrieve_context', withTelemetry('retrieve_context', retrieveContextNode))
    .addNode('human_review', humanReviewNode)
    .addNode('store_fhir', withTelemetry('store_fhir', storeFhirNode))
    .addEdge(START, 'accumulate')
    .addConditionalEdges('accumulate', routeByEvent, { retrieve_context: 'retrieve_context', __end__: END })
    .addEdge('retrieve_context', 'human_review')
    .addEdge('human_review', 'store_fhir')
    .addEdge('store_fhir', END);

  compiledGraph = workflow.compile({ checkpointer });

  const input = {
    room_id: roomId,
    session_status: eventType === 'end_session' ? 'ended' : 'active',
    session_metadata: options.session_metadata || {},
    encounter_id: options.encounter_id,
    clinic_id: options.clinic_id,
    patient_id: options.patient_id,
    patient_name: options.patientName,
    provider_id: options.provider_id,
    event_type: eventType
  };

  if (eventType === 'transcript') {
    input.audio_transcript = [payload];
  } else if (eventType === 'vision_frame') {
    input.video_frames = [payload];
  }

  const config = {
    configurable: { thread_id: roomId },
    runName: `video_consult_${eventType}`,
    tags: ['video-consult', eventType, roomId]
  };

  try {
    const result = await compiledGraph.invoke(input, config);
    return {
      success: true,
      stage: result.current_stage,
      requires_review: result.error?.recoverable || false
    };
  } catch (err) {
    console.error('[video-consult-graph] invoke error:', err);
    return {
      success: false,
      error: err.message,
      stage: 'ERROR'
    };
  }
}

/**
 * Process end_session: run full pipeline and store to FHIR.
 * Call this when the video call ends.
 */
async function processEndSession(roomId, options = {}) {
  return processEvent(roomId, 'end_session', { end: true }, options);
}

module.exports = {
  processEvent,
  processEndSession
};
