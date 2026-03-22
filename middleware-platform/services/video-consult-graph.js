/**
 * Video Consult LangGraph
 * Orchestrates multimodal telehealth: transcript + vision → perceive → RAG → reason → FHIR.
 * Event-driven: full pipeline runs only on end_session.
 * See docs/architecture for VIDEO_CONSULT_ARCHITECTURE.md
 */

const db = require('../database');
const FHIRService = require('./fhir-service');
const tokenBudget = require('../utils/token-budget');
const knowledgeService = require('./knowledge-service');
const reviewTaskService = require('./review-task-service');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

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
        // Normalize into an array of transcript events
        const p = Array.isArray(prev) ? prev : [];
        const n = Array.isArray(next)
          ? next
          : [next].filter(Boolean);
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

  // Dual-source RAG: Pinecone (clinical context / optional codes) + local knowledge-service (72K ICD-10, CPT). Codes are merged and deduped; local is primary when Pinecone has no code metadata.
  async function retrieveContextNode(state) {
    const emptyRagContext = () => ({
      icd10: [],
      cpt: [],
      hcpcs: [],
      merged_codes: { icd10: [], cpt: [], hcpcs: [] },
      remote_knowledge: { icd10: [], cpt: [], hcpcs: [] },
      local_knowledge: { icd10: [], cpt: [], hcpcs: [] },
      query: '',
      specialty: 'general'
    });

    try {
      const transcript = state.audio_transcript || [];
      let text = transcript
        .map(t => (typeof t === 'string' ? t : (t.text || t.content || '')))
        .filter(Boolean)
        .join(' ')
        .slice(0, 2000);

      // vc-14: Prepend patient document extracts for live during-call RAG context
      const patientId = state.patient_id;
      if (patientId && db.getPatientDocumentExtractsByPatient) {
        try {
          const extracts = db.getPatientDocumentExtractsByPatient(patientId) || [];
          const docContext = extracts
            .filter(e => e.extracted_text?.trim())
            .slice(0, 5)
            .map(e => (e.extracted_text || '').trim().slice(0, 800))
            .join('\n');
          if (docContext) text = `[Patient record excerpts]\n${docContext}\n\n[Visit]\n${text}`;
        } catch (e) {
          console.warn('[video-consult][RAG] patient extracts fetch failed:', e.message);
        }
      }

      if (!text.trim()) {
        return { rag_context: emptyRagContext(), current_stage: 'RAG_SKIPPED_NO_TEXT' };
      }

      const specialty = state.perceptual_state?.specialty_tag || 'general';
      const queryPreview = text.slice(0, 120);
      console.log(`[video-consult][RAG] Querying (${specialty}): "${queryPreview}${text.length > 120 ? '…' : ''}"`);

      // §6 Optional: for non-English consults, translate text here (e.g. perception extractAndNormalizeText) before RAG
      const dual = await knowledgeService.getCodeCandidatesDualSource(text, {
        specialty,
        useSemantic: true,
        maxIcd10: 20,
        maxCpt: 15,
        maxHcpcs: 10
      });

      const remote = dual.remote_knowledge || { icd10: [], cpt: [], hcpcs: [] };
      const local = dual.local_knowledge || { icd10: [], cpt: [], hcpcs: [] };
      const merged = dual.merged_codes || { icd10: dual.icd10 || [], cpt: dual.cpt || [], hcpcs: dual.hcpcs || [] };

      const mergedCount = (merged.icd10?.length || 0) + (merged.cpt?.length || 0) + (merged.hcpcs?.length || 0);
      const ragCoverage = Math.min(mergedCount / 15, 1.0);
      const remoteCount = (remote.icd10 || []).length + (remote.cpt || []).length + (remote.hcpcs || []).length;
      const localCount = (local.icd10 || []).length + (local.cpt || []).length + (local.hcpcs || []).length;

      console.log(`[video-consult][RAG] Remote: ${(remote.icd10 || []).length} ICD-10, ${(remote.cpt || []).length} CPT; Local: ${(local.icd10 || []).length} ICD-10, ${(local.cpt || []).length} CPT; Merged (validated): ${mergedCount}`);

      // §3 Observability: pipeline summary in node output so LangSmith trace shows remote/local/merged counts
      return {
        rag_context: {
          remote_knowledge: remote,
          local_knowledge: local,
          merged_codes: merged,
          icd10: merged.icd10,
          cpt: merged.cpt,
          hcpcs: merged.hcpcs,
          query: text,
          specialty,
          invalid_codes: dual.invalid_codes
        },
        current_stage: mergedCount > 0 ? 'RAG_COMPLETE' : 'RAG_FALLBACK_EMPTY',
        confidence_scores: { rag_coverage: ragCoverage },
        processing_metadata: {
          colab_success: remote.metadata?.source !== 'remote_error',
          local_success: local.metadata?.source !== 'local_error',
          remote_count: remoteCount,
          local_count: localCount,
          merged_count: mergedCount
        }
      };
    } catch (err) {
      console.warn('[video-consult-graph] retrieveContextNode error (continuing without RAG):', err.message);
      return {
        rag_context: emptyRagContext(),
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
      const messages = transcript
        .map(t => ({
          text: typeof t === 'string' ? t : (t.text || t.content || ''),
          speaker: t.speaker || 'unknown',
          timestamp: t.timestamp || new Date().toISOString(),
          source: t.source || 'agent_stt'
        }))
        .filter(m => m.text);

      if (messages.length === 0) {
        return { current_stage: 'FHIR_SKIPPED_NO_TRANSCRIPT', error: null };
      }

      let patientId = state.patient_id;
      let encounterId = state.encounter_id || state.room_id;
      const patientName = state.patient_name || options.patientName || 'Video Consult Patient';

      // Ensure patient exists for FK (local testing: create placeholder when unknown)
      if (!patientId || patientId === 'unknown') {
        try {
          const patientResult = await FHIRService.getOrCreatePatient(
            { name: patientName, firstName: patientName.split(' ')[0] || 'Video', lastName: patientName.split(' ').slice(1).join(' ') || 'Patient' },
            false
          );
          const p = patientResult?.patient;
          if (p?.id) patientId = p.id;
          else if (p?.resource_id) patientId = p.resource_id;
          else if (p?.subject?.reference) patientId = p.subject.reference.replace('Patient/', '');
        } catch (e) {
          console.warn('[video-consult-graph] getOrCreatePatient failed:', e.message);
          return { current_stage: 'FHIR_SKIPPED_NO_PATIENT', error: { message: 'Could not create patient for transcript', recoverable: true } };
        }
      }
      if (!patientId) {
        return { current_stage: 'FHIR_SKIPPED_NO_PATIENT', error: null };
      }

      // Ensure encounter exists for FK
      try {
        const existingEnc = db.getFHIREncounter && db.getFHIREncounter(encounterId);
        if (!existingEnc) {
          const enc = await FHIRService.createEncounter({
            patientId,
            patientName,
            callId: state.room_id,
            status: 'finished',
            startTime: new Date().toISOString(),
            type: 'Video consultation',
            reasonText: `Video consult room ${state.room_id}`
          });
          if (enc?.id) encounterId = enc.id;
        }
      } catch (e) {
        console.warn('[video-consult-graph] createEncounter failed, storing transcript without encounter:', e.message);
        encounterId = undefined; // createCommunication allows no encounter
      }

      const notes = [{ text: `Video consult transcript (room: ${state.room_id})`, time: new Date().toISOString() }];
      const rag = state.rag_context || {};
      const icd10 = rag.icd10 || rag.merged_codes?.icd10 || [];
      const cpt = rag.cpt || rag.merged_codes?.cpt || [];
      const icdStr = icd10.map((c) => (c.code || c)).filter(Boolean).join(', ');
      const cptStr = cpt.map((c) => (c.code || c)).filter(Boolean).join(', ');
      if (icdStr || cptStr) {
        notes.push({
          text: `Suggested codes: ICD-10: ${icdStr || 'none'}; CPT: ${cptStr || 'none'}`,
          time: new Date().toISOString()
        });
      }

      await FHIRService.storeTranscript({
        patientId,
        patientName,
        encounterId,
        messages,
        sentTime: new Date().toISOString(),
        notes
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

  /**
   * Phase 7 Task 54: trigger_case_report — runs after store_fhir.
   * If appointment.status === 'completed': insert pending row, fire-and-forget POST to case report service.
   */
  async function triggerCaseReportNode(state) {
    const caseReportUrl = process.env.CASE_REPORT_SERVICE_URL;
    const callbackToken = process.env.CASE_REPORT_SERVICE_TOKEN;
    if (!caseReportUrl || !callbackToken) {
      return {};
    }
    const encounterId = state.encounter_id;
    const patientId = state.patient_id;
    if (!encounterId || !patientId) return {};

    // Double-trigger guard: if a case report already exists for this encounter, skip.
    if (db.getCaseReportByEncounterId) {
      try {
        const existing = db.getCaseReportByEncounterId(encounterId);
        if (existing && existing.status && ['pending', 'completed', 'failed'].includes(existing.status)) {
          return {};
        }
      } catch (e) {
        console.warn('[video-consult-graph] getCaseReportByEncounterId failed:', e.message);
      }
    }
    const appointmentId = state.session_metadata?.appointment_id ||
      (state.room_id && state.room_id.startsWith('appt-') ? state.room_id.replace(/^appt-/, '') : null);
    if (appointmentId) {
      try {
        const appointment = await db.getAppointment(appointmentId);
        if (!appointment || (appointment.status || '').toLowerCase() !== 'completed') return {};
      } catch (_) {
        return {};
      }
    }
    if (!db.insertPendingCaseReport) return {};
    let priorReportId = null;
    if (db.getDiagnosticReportsByPatientId) {
      const priorReports = db.getDiagnosticReportsByPatientId(patientId, 10);
      const prior = priorReports.find(r => r.encounter_id && r.encounter_id !== encounterId);
      if (prior && (prior.resource_id || prior.resource_data?.id)) priorReportId = prior.resource_id || prior.resource_data?.id;
    }
    const jobId = `job-${uuidv4()}`;
    db.insertPendingCaseReport({ job_id: jobId, patient_id: patientId, encounter_id: encounterId, appointment_id: appointmentId || null });

    // Backfill encounter_id onto any existing uploads for this appointment.
    if (appointmentId && db.db && db.db.prepare) {
      try {
        db.db.prepare(`
          UPDATE patient_uploads
          SET encounter_id = ?
          WHERE appointment_id = ? AND (encounter_id IS NULL OR encounter_id = '')
        `).run(encounterId, appointmentId);
      } catch (e) {
        console.warn('[video-consult-graph] patient_uploads backfill failed:', e.message);
      }
    }
    const baseUrl = (process.env.API_BASE_URL || process.env.BASE_URL || '').replace(/\/$/, '');
    const transcriptEndpoint = `${baseUrl}/internal/communications/${encounterId}/text`;
    const documentContextEndpoint = `${baseUrl}/internal/communications/${encounterId}/document-context`;
    const vitalsEndpoint = `${baseUrl}/internal/communications/${encounterId}/vitals`;
    const callbackUrl = `${baseUrl}/api/case-report/callback`;
    const payload = {
      job_id: jobId,
      patient_id: patientId,
      encounter_id: encounterId,
      appointment_id: appointmentId || null,
      transcript_endpoint: transcriptEndpoint,
      transcript_endpoint_token: callbackToken,
      document_context_endpoint: documentContextEndpoint,
      document_context_endpoint_token: callbackToken,
      vitals_endpoint: vitalsEndpoint,
      vitals_endpoint_token: callbackToken,
      prior_report_id: priorReportId,
      callback_url: callbackUrl,
      callback_token: callbackToken
    };
    axios.post(`${caseReportUrl.replace(/\/$/, '')}/report`, payload, { timeout: 10000 })
      .catch(err => console.warn('[video-consult-graph] trigger_case_report POST failed:', err.message));
    return {};
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
    .addNode('trigger_case_report', triggerCaseReportNode)
    .addEdge(START, 'accumulate')
    .addConditionalEdges('accumulate', routeByEvent, { retrieve_context: 'retrieve_context', __end__: END })
    .addEdge('retrieve_context', 'human_review')
    .addEdge('human_review', 'store_fhir')
    .addEdge('store_fhir', 'trigger_case_report')
    .addEdge('trigger_case_report', END);

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
      requires_review: result.error?.recoverable || false,
      rag_context: result.rag_context || null,
      error: result.error || null,
      audio_transcript: result.audio_transcript || null
    };
  } catch (err) {
    console.error('[video-consult-graph] invoke error:', err);
    return {
      success: false,
      error: err.message,
      stage: 'ERROR',
      rag_context: null
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
