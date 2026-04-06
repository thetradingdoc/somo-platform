'use strict';

/**
 * Step 10 reasoning pipeline — LangGraph skeleton (L1→L6 shape from reference `step10`).
 * Feature-flagged: set STEP10_GRAPH_ENABLED=true to compile/run; otherwise invoke returns stub.
 *
 * Real layer logic (perception, clusters, audit) should replace stub nodes incrementally.
 */

const STEP10_GRAPH_ENABLED =
  String(process.env.STEP10_GRAPH_ENABLED || 'false').toLowerCase() === 'true';

let _compiled = null;

/**
 * Routing after L2: "short" jumps to audit (L6); "full" continues L3→L5.
 * Exported for unit tests and future policy tuning.
 */
function routeAfterLayer2(state) {
  const inputs = state?.inputs && typeof state.inputs === 'object' ? state.inputs : {};
  if (inputs.skip_to_audit) return 'short';
  if (inputs.low_confidence === true || inputs.low_confidence === '1' || String(inputs.low_confidence).toLowerCase() === 'true') {
    return 'short';
  }
  const c = inputs.confidence;
  if (typeof c === 'number' && Number.isFinite(c) && c < 0.35) {
    return 'short';
  }
  return 'full';
}

function emitStep10GraphEvent(name, meta = {}) {
  try {
    const db = require('../database');
    if (db.incrementOpsCounter) db.incrementOpsCounter(`step10_${name}`);
  } catch (_) {}
  try {
    const log = require('./secure-logger');
    log.info(`[step10-graph] ${name}`, meta);
  } catch (_) {}
}

async function loadLG() {
  try {
    return await import('@langchain/langgraph');
  } catch (e) {
    console.warn('[step10-graph] LangGraph import failed:', e.message);
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
      const cp = PostgresSaver.fromConnString(connStr, { schema: process.env.LANGGRAPH_CHECKPOINT_SCHEMA || 'public' });
      await cp.setup();
      return cp;
    } catch (e) {
      console.warn('[step10-graph] PostgresSaver failed, MemorySaver:', e.message);
    }
  }
  const LG = await loadLG();
  return LG ? new LG.MemorySaver() : null;
}

function stubNode(name) {
  return async () => {
    emitStep10GraphEvent(`node_${name}`);
    return {
      layer_trace: [{ layer: name, at: new Date().toISOString() }],
      current_layer: name
    };
  };
}

async function compileGraph() {
  // If the first compile fails (e.g. Postgres checkpointer), _compiled stays null so the next call retries.
  if (_compiled) return _compiled;
  const LG = await loadLG();
  if (!LG) return null;
  const { StateGraph, Annotation, START, END, MemorySaver } = LG;
  const cp = (await getCheckpointer()) || new MemorySaver();

  const S = Annotation.Root({
    patient_id: Annotation({ reducer: (a, b) => b ?? a }),
    thread_id: Annotation({ reducer: (a, b) => b ?? a }),
    inputs: Annotation({ reducer: (a, b) => (b ? { ...a, ...b } : a) ?? {} }),
    layer_trace: Annotation({
      reducer: (prev, next) => {
        const p = Array.isArray(prev) ? prev : [];
        const n = Array.isArray(next) ? next : next ? [next] : [];
        return [...p, ...n];
      }
    }),
    current_layer: Annotation({ reducer: (a, b) => b ?? a }),
    summary: Annotation({ reducer: (a, b) => b ?? a }),
    error: Annotation({ reducer: (a, b) => b ?? a })
  });

  const g = new StateGraph(S)
    .addNode('layer1_perception', stubNode('L1_perception'))
    .addNode('layer2_cluster', stubNode('L2_cluster'))
    .addNode('layer3_reason', stubNode('L3_reason'))
    .addNode('layer4_differential', stubNode('L4_differential'))
    .addNode('layer5_plan', stubNode('L5_plan'))
    .addNode('layer6_audit', async () => {
      emitStep10GraphEvent('node_L6_audit');
      return {
        layer_trace: [{ layer: 'L6_audit', at: new Date().toISOString() }],
        current_layer: 'L6_audit',
        summary: 'Step10 graph stub complete — replace nodes with real pipeline logic.'
      };
    })
    .addEdge(START, 'layer1_perception')
    .addEdge('layer1_perception', 'layer2_cluster')
    .addConditionalEdges('layer2_cluster', (state) => {
      const r = routeAfterLayer2(state);
      emitStep10GraphEvent(r === 'short' ? 'route_skip_to_audit' : 'route_full_pipeline');
      return r === 'short' ? 'audit' : 'reason';
    }, {
      audit: 'layer6_audit',
      reason: 'layer3_reason'
    })
    .addEdge('layer3_reason', 'layer4_differential')
    .addEdge('layer4_differential', 'layer5_plan')
    .addEdge('layer5_plan', 'layer6_audit')
    .addEdge('layer6_audit', END);

  _compiled = g.compile({ checkpointer: cp });
  return _compiled;
}

/**
 * @param {object} input
 * @param {string} [input.patient_id]
 * @param {string} [input.thread_id]
 * @param {object} [input.inputs] arbitrary payloads for future nodes (e.g. skip_to_audit)
 */
async function invokeStep10(input = {}) {
  const { startTrace, endTrace } = require('./langsmith-trace-service');
  const threadId = String(input.thread_id || input.patient_id || `step10_${Date.now()}`).trim();
  const traceCtx = await startTrace({
    name: 'step10_invoke',
    inputs: {
      thread_id: threadId,
      patient_id: input.patient_id || null
    },
    tags: ['step10', 'middleware', 'langgraph'],
    metadata: {
      graph_enabled: STEP10_GRAPH_ENABLED,
      has_inputs: !!(input.inputs && typeof input.inputs === 'object')
    }
  });

  const finishOk = async (out) => {
    await endTrace(traceCtx, {
      outputs: {
        success: !!out.success,
        stub: !!out.stub,
        summary: out.state?.summary ?? out.summary ?? null
      }
    });
    return out;
  };
  const finishErr = async (e, partial) => {
    await endTrace(traceCtx, { error: e?.message || String(e), outputs: partial || {} });
  };

  const dermPayload = input.inputs && typeof input.inputs === 'object' ? input.inputs.derm_patient_qa : null;
  if (dermPayload && typeof dermPayload === 'object' && String(process.env.DERM_EDUCATION_PIPELINE_ENABLED || 'false').toLowerCase() === 'true') {
    try {
      emitStep10GraphEvent('derm_patient_qa_branch');
      const { runDermPatientQAPipeline } = require('./derm-patient-qa-pipeline');
      const out = await runDermPatientQAPipeline({
        message: dermPayload.message,
        imageCaption: dermPayload.imageCaption || dermPayload.image_caption,
        imagePresent: !!dermPayload.imagePresent || !!dermPayload.image_present,
        structuredIntake: dermPayload.structuredIntake,
        recentTurns: dermPayload.recentTurns,
        triage: dermPayload.triage,
        retrieval: dermPayload.retrieval,
        skip_retrieve: dermPayload.skip_retrieve,
        filters: dermPayload.filters,
        skip_llm: dermPayload.skip_llm,
        debug: dermPayload.debug
      });
      return finishOk({
        success: !!out.success,
        stub: false,
        derm_patient_qa: out,
        state: {
          summary: out.answer_text ?? null,
          layer_trace: [{ layer: 'derm_patient_qa', at: new Date().toISOString() }],
          current_layer: 'derm_patient_qa',
          error: out.success ? null : out.error || null
        }
      });
    } catch (e) {
      emitStep10GraphEvent('derm_patient_qa_error');
      await finishErr(e, { success: false });
      return { success: false, error: e.message || 'derm_patient_qa_failed', layer_trace: [] };
    }
  }

  if (!STEP10_GRAPH_ENABLED) {
    emitStep10GraphEvent('invoke_stub');
    return finishOk({
      success: true,
      stub: true,
      message: 'STEP10_GRAPH_ENABLED is false — enable to run LangGraph pipeline.',
      layer_trace: [],
      summary: null
    });
  }

  const graph = await compileGraph();
  if (!graph) {
    const out = { success: false, error: 'langgraph_unavailable', layer_trace: [] };
    await finishErr(new Error(out.error), { success: false });
    return out;
  }

  const config = { configurable: { thread_id: threadId } };

  try {
    emitStep10GraphEvent('invoke_start');
    const out = await graph.invoke(
      {
        patient_id: input.patient_id || null,
        thread_id: threadId,
        inputs: input.inputs && typeof input.inputs === 'object' ? input.inputs : {},
        layer_trace: [],
        current_layer: null,
        summary: null,
        error: null
      },
      config
    );
    emitStep10GraphEvent('invoke_ok');
    return finishOk({ success: true, stub: false, state: out });
  } catch (e) {
    emitStep10GraphEvent('invoke_error');
    await finishErr(e, { success: false });
    return { success: false, error: e.message || 'step10_invoke_failed', layer_trace: [] };
  }
}

module.exports = {
  STEP10_GRAPH_ENABLED,
  invokeStep10,
  compileGraph,
  routeAfterLayer2
};
