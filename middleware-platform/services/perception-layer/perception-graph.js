/**
 * PERCEPTION GRAPH - Layer 1 LangGraph DAG
 *
 * Stateful DAG for multimodal clinical perception: Vision (GPT-4o) + Text (GPT-4o) + ClinicalBERT.
 * Fan-In to Fusion → Grounding Verification → Confidence Threshold → Audit.
 *
 * State schema: visual_findings, textual_extraction, clinical_entities, perceptual_state,
 *               raw_transcript, image_metadata, fusion_reasoning, requires_human_review
 */

const visionEncoder = require('./vision-encoder');
const clinicalBert = require('./clinical-bert-service');
const medicalTextExtraction = require('../clinical/medical-text-extraction-service');
const textEncoder = require('./text-encoder');

const CONFIDENCE_THRESHOLD = parseFloat(process.env.PERCEPTION_CONFIDENCE_THRESHOLD || '0.85');
const CLINICAL_BERT_MAX_TOKENS = 512;

/** Clinical entity types to include in textual_findings (not just 'symptom'). */
const CLINICAL_ENTITY_TYPES = [
  'symptom', 'sign_symptom', 'clinical_entity', 'diagnostic_procedure',
  'anatomy', 'finding', 'disease', 'disorder', 'syndrome', 'procedure', 'treatment'
];
/** Types eligible for grounded finding (excludes temporal). */
const GROUNDED_FINDING_TYPES = [
  'symptom', 'sign_symptom', 'finding', 'disease', 'disorder', 'diagnostic_procedure',
  'clinical_entity', 'anatomy', 'procedure', 'treatment'
];

const LATERALITY_SYNONYMS = {
  left: ['left', 'lt', 'left-sided', 'left side', 'lateral left'],
  right: ['right', 'rt', 'right-sided', 'right side', 'lateral right'],
  bilateral: ['bilateral', 'both sides', 'both limbs', 'both arms', 'both legs'],
  midline: ['midline', 'central line', 'centerline'],
  none: ['none', 'no laterality', 'unspecified']
};

function normalizeLaterality(value) {
  if (!value) return null;
  const text = String(value).toLowerCase().trim();
  for (const [canonical, synonyms] of Object.entries(LATERALITY_SYNONYMS)) {
    if (synonyms.some((syn) => text.includes(syn))) {
      return canonical === 'none' ? null : canonical;
    }
  }
  if (['left', 'right', 'bilateral', 'midline'].includes(text)) return text;
  return null;
}

function detectLateralityFromText(text) {
  if (!text) return null;
  const lowered = String(text).toLowerCase();
  if (/(bilateral|both\s+sides|both\s+arms|both\s+legs|both\s+shoulders)/.test(lowered)) return 'bilateral';
  if (/\bmidline\b/.test(lowered)) return 'midline';
  if (/\bright\b/.test(lowered)) return 'right';
  if (/\bleft\b/.test(lowered)) return 'left';
  return null;
}

function computeConsensusLaterality(visualFindings = [], textualFindings = [], textExtractionLaterality = null) {
  const mentions = [];
  visualFindings.forEach((vf) => {
    const lat = normalizeLaterality(vf?.laterality);
    if (lat) mentions.push(lat);
  });
  textualFindings.forEach((tf) => {
    if (!tf || typeof tf !== 'object') return;
    const lat = normalizeLaterality(tf.laterality) || detectLateralityFromText(tf.mention || tf.concept);
    if (lat) mentions.push(lat);
  });
  const extracted = normalizeLaterality(textExtractionLaterality);
  if (extracted) mentions.push(extracted);

  if (mentions.length === 0) return null;
  const unique = [...new Set(mentions)];
  if (unique.length === 1) return unique[0];
  return 'conflict';
}

/**
 * Null-safe initial state. Fusion and downstream nodes never receive null.
 */
function createInitialState(inputs = {}) {
  return {
    callId: inputs.callId || 'unknown',
    modality: inputs.modality || 'text',
    clinicId: inputs.clinicId || null,

    raw_transcript: (inputs.clinicalText || '').toString().trim(),
    image_path: inputs.imagePath || null,
    image_metadata: null,

    visual_findings: [],
    textual_extraction: {},
    clinical_entities: [],

    perceptual_state: null,
    fusion_reasoning: null,
    requires_human_review: { flag: false, reasons: [], severity: null },

    processing_metadata: {},
    audit_log: []
  };
}

/**
 * Rough token estimate (4 chars ≈ 1 token for English)
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Sliding window chunk for ClinicalBERT 512-token limit.
 * Returns overlapping chunks; caller merges entities.
 */
function chunkForBert(text, maxTokens = CLINICAL_BERT_MAX_TOKENS, overlap = 64) {
  if (!text || estimateTokens(text) <= maxTokens) return [text];
  const charsPerToken = 4;
  const chunkSize = maxTokens * charsPerToken;
  const step = chunkSize - overlap * charsPerToken;
  const chunks = [];
  for (let i = 0; i < text.length; i += step) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * VISION NODE (GPT-4o)
 */
async function visionNode(state) {
  if (!state.image_path) {
    return { visual_findings: [], processing_metadata: { ...state.processing_metadata, vision_ms: 0, vision_skipped: true } };
  }
  const t0 = Date.now();
  try {
    const findings = await visionEncoder.extractVisualFindings(
      state.image_path,
      state.modality || 'xray',
      state.raw_transcript ? { chief_complaint: state.raw_transcript.slice(0, 200) } : null
    );
    return {
      visual_findings: Array.isArray(findings) ? findings : [],
      image_metadata: { path: state.image_path, processed_at: new Date().toISOString() },
      processing_metadata: { ...state.processing_metadata, vision_ms: Date.now() - t0 }
    };
  } catch (e) {
    console.warn(`[${state.callId}] Vision node failed:`, e.message);
    return {
      visual_findings: [],
      processing_metadata: { ...state.processing_metadata, vision_ms: Date.now() - t0, vision_error: e.message }
    };
  }
}

/**
 * TEXT NODE (GPT-4o) - Extract, translate, normalize to clean English
 */
async function textNode(state) {
  if (!state.raw_transcript) {
    return { textual_extraction: {}, processing_metadata: { ...state.processing_metadata, text_ms: 0, text_skipped: true } };
  }
  const t0 = Date.now();
  try {
    const result = await extractAndNormalizeText(state.raw_transcript);
    return {
      textual_extraction: result,
      processing_metadata: { ...state.processing_metadata, text_ms: Date.now() - t0 }
    };
  } catch (e) {
    console.warn(`[${state.callId}] Text node failed:`, e.message);
    return {
      textual_extraction: { normalized_text: state.raw_transcript, symptoms: [], vitals: {}, temporal: {}, detected_language: 'unknown' },
      processing_metadata: { ...state.processing_metadata, text_ms: Date.now() - t0, text_error: e.message }
    };
  }
}

/**
 * GPT-4o text extraction: translate if needed, extract structured content
 */
async function extractAndNormalizeText(rawText) {
  const { ChatOpenAI } = require('@langchain/openai');
  const { HumanMessage } = require('@langchain/core/messages');
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    const structured = medicalTextExtraction.extractStructuredData(rawText || '');
    return {
      normalized_text: rawText,
      symptoms: structured.symptoms || [],
      vitals: structured.vitals || {},
      temporal: structured.temporal || {},
      detected_language: 'en'
    };
  }
  const model = new ChatOpenAI({ modelName: 'gpt-4o-mini', temperature: 0.1, maxTokens: 1500 });
  const prompt = `You are a clinical text normalizer. For the following patient utterance (which may be in any language, contain typos or slang):

"${(rawText || '').slice(0, 4000)}"

TASK:
1. If not English, translate to English. If English, fix typos and expand abbreviations.
2. Extract: symptoms (list), vitals (temp, BP, HR if mentioned), temporal (duration, onset).
3. Preserve medical terms. Output ONLY valid JSON:

{"normalized_text": "...", "symptoms": ["..."], "vitals": {}, "temporal": {}, "detected_language": "en"}

If no vitals/temporal, use empty object {}.`;
  const res = await model.invoke([new HumanMessage(prompt)]);
  const text = (res?.content || '').toString();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_) {}
  }
  const structured = medicalTextExtraction.extractStructuredData(rawText || '');
  return {
    normalized_text: rawText,
    symptoms: structured.symptoms || [],
    vitals: structured.vitals || {},
    temporal: structured.temporal || {},
    detected_language: 'en'
  };
}

/**
 * CLINICALBERT NODE - Biomedical NER transformer on normalized text.
 * Uses onnx-community/biomedical-ner-all-ONNX (107 entity types). No rule-based fallback.
 * Backbone of the perception pipeline. Handles 512-token limit via sliding window.
 */
async function clinicalBertNode(state) {
  const text = state.textual_extraction?.normalized_text || state.raw_transcript || '';
  if (!text) {
    return { clinical_entities: [], processing_metadata: { ...state.processing_metadata, bert_ms: 0, bert_skipped: true } };
  }
  try {
    const { entities, chunks, ms } = await clinicalBert.extractClinicalEntities(text);
    return {
      clinical_entities: entities,
      processing_metadata: { ...state.processing_metadata, bert_ms: ms, bert_chunks: chunks }
    };
  } catch (e) {
    console.error(`[${state.callId}] ClinicalBERT node failed:`, e.message);
    throw e;
  }
}

/**
 * FUSION NODE - Synthesize visual + text + clinical entities into perceptual_state
 */
function fusionNode(state) {
  const visual = state.visual_findings || [];
  const textExt = state.textual_extraction || {};
  const entities = state.clinical_entities || [];
  const reasoning = [];

  const negResult = textEncoder.extractNegativeFindings(state.raw_transcript || '');
  const exclusionKeywords = new Set((negResult.exclusion_keywords || []).map(k => k.toLowerCase()));
  const negativePhrases = (negResult.negative_findings || []).map(n => n.phrase).filter(Boolean);

  const groundedFindings = [];
  const evidence = { image: [], text: [] };

  for (const v of visual) {
    evidence.image.push({ finding: v.finding, body_region: v.body_region, laterality: v.laterality, confidence: v.confidence });
  }
  for (const s of textExt.symptoms || []) {
    evidence.text.push({ concept: s, source: 'text_extraction' });
  }
  for (const e of entities) {
    if (CLINICAL_ENTITY_TYPES.includes(e.type) && !evidence.text.some(t => t.concept === e.text)) {
      evidence.text.push({ concept: e.text, source: 'clinical_entity' });
    }
  }

  const textualFindings = [
    ...(textExt.symptoms || []).map((sym) => ({
      concept: sym,
      mention: sym,
      confidence: 0.9,
      type: 'symptom',
      source: 'gpt4o',
      laterality: detectLateralityFromText(sym)
    })),
    ...entities
      .filter(e => CLINICAL_ENTITY_TYPES.includes(e.type))
      .map(e => ({
        concept: e.text,
        mention: e.text,
        confidence: e.confidence,
        type: e.type,
        source: 'clinical_bert',
        laterality: detectLateralityFromText(e.text)
      }))
  ];

  const specialty = inferSpecialty(visual, textExt, entities);
  let conflictFlag = false;
  const consensusLaterality = computeConsensusLaterality(visual, textualFindings, textExt.laterality);
  if (consensusLaterality === 'conflict') {
    conflictFlag = true;
    reasoning.push('Laterality conflict detected across modalities');
  }

  const pickGroundedText = () => {
    const symptoms = textExt.symptoms || [];
    const bestEntity = selectBestGroundedEntity(entities, exclusionKeywords);
    const bestEntityText = bestEntity?.text || entities[0]?.text || '';
    const bestSymptom = symptoms.find(s => {
      const t = String(s).toLowerCase();
      const words = t.split(/\s+/).filter(Boolean);
      return words.length >= 2 && !words.some(w => exclusionKeywords.has(w)) && !exclusionKeywords.has(t);
    }) || symptoms[0];
    const bestSymptomText = bestSymptom ? String(bestSymptom).trim() : '';
    if (bestSymptomText && bestSymptomText.length > (bestEntityText || '').length) {
      return bestSymptomText;
    }
    return bestEntityText || bestSymptomText || 'unknown';
  };

  if (visual.length > 0 && entities.length > 0) {
    const vFinding = visual[0];
    const topText = pickGroundedText();
    groundedFindings.push({
      grounded_finding: `${vFinding.laterality || ''} ${vFinding.body_region || ''} ${vFinding.finding || ''}`.trim() || vFinding.finding,
      evidence: { image: [vFinding], text: entities.slice(0, 3).map(e => e.text) },
      specialty,
      conflict_flag: conflictFlag
    });
    reasoning.push(`Fused: visual "${vFinding.finding}" + clinical entity "${topText}"`);
  } else if (entities.length > 0 || (textExt.symptoms || []).length > 0) {
    const groundedText = pickGroundedText();
    groundedFindings.push({
      grounded_finding: groundedText,
      evidence: { image: [], text: (entities.slice(0, 5).map(e => e.text).filter(Boolean)).concat(textExt.symptoms || []).slice(0, 5) },
      specialty,
      conflict_flag: false
    });
    reasoning.push(`Text-only: primary "${groundedText}" (GPT-4o + ClinicalBERT)`);
  } else if (visual.length > 0) {
    const v = visual[0];
    groundedFindings.push({
      grounded_finding: `${v.laterality || ''} ${v.body_region || ''} ${v.finding}`.trim() || v.finding,
      evidence: { image: [v], text: [] },
      specialty,
      conflict_flag: false
    });
    reasoning.push(`Image-only: primary finding "${v.finding}"`);
  }

  const minConf = Math.min(
    ...visual.map(f => f.confidence ?? 0.5),
    ...entities.map(e => e.confidence ?? 0.5),
    0.9
  );
  const avgConf = visual.length + entities.length > 0
    ? (visual.reduce((a, f) => a + (f.confidence ?? 0.5), 0) + entities.reduce((a, e) => a + (e.confidence ?? 0.5), 0)) / (visual.length + entities.length)
    : 0.5;

  const perceptual_state = {
    grounded_findings: groundedFindings,
    evidence,
    specialty: specialty || 'general',
    conflict_flag: conflictFlag,
    laterality: consensusLaterality,
    confidence_score: avgConf,
    textual_findings: textualFindings,
    visual_findings: visual,
    negative_findings: Array.from(exclusionKeywords),
    negative_phrases: negativePhrases,
    region_tag: 'US'
  };

  return {
    perceptual_state,
    fusion_reasoning: reasoning.join('; '),
    processing_metadata: { ...state.processing_metadata, fusion_ms: 0 }
  };
}

/** Type weight for ranking: higher = more clinically salient for primary finding. */
const TYPE_WEIGHT = {
  finding: 1.2, disease: 1.2, disorder: 1.1, syndrome: 1.1,
  sign_symptom: 1.0, symptom: 1.0,
  diagnostic_procedure: 0.9, procedure: 0.9, treatment: 0.9,
  clinical_entity: 0.85, anatomy: 0.8
};

/**
 * Select best entity for grounded finding: filter clinical, exclude negated,
 * rank by confidence × type weight.
 * @param {Array} entities - Clinical entities
 * @param {Set<string>} exclusionKeywords - Terms to exclude (from negation extraction)
 */
function selectBestGroundedEntity(entities, exclusionKeywords = new Set()) {
  const exclude = exclusionKeywords;
  const eligible = entities.filter(e => {
    if (!GROUNDED_FINDING_TYPES.includes(e.type) || (e.text || '').trim().length <= 2) return false;
    const txt = (e.text || '').toLowerCase();
    const words = txt.split(/\s+/).filter(Boolean);
    if (words.some(w => exclude.has(w))) return false;
    if (exclude.has(txt)) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  const scored = eligible.map(e => ({
    ...e,
    _score: (e.confidence ?? 0.5) * (TYPE_WEIGHT[e.type] ?? 0.8),
    _words: (e.text || '').trim().split(/\s+/).filter(Boolean).length
  }));
  scored.sort((a, b) => (b._score || 0) - (a._score || 0));
  // Among top 3 by score, prefer longer phrases (more specific)
  const top = scored.slice(0, 3);
  const bestBySpecificity = top.reduce((best, cur) =>
    (cur._words || 0) > (best._words || 0) ? cur : best
  );
  return bestBySpecificity;
}

function inferSpecialty(visual, textExt, entities) {
  const terms = [
    ...(visual || []).flatMap(v => [v.finding, v.body_region].filter(Boolean)),
    ...(textExt.symptoms || []),
    ...(entities || []).map(e => e.text)
  ].map(t => String(t).toLowerCase());
  const text = terms.join(' ');
  const map = {
    orthopedics: ['fracture', 'dislocation', 'sprain', 'bone', 'joint', 'radius', 'ulna', 'wrist', 'ankle', 'knee'],
    cardiology: ['chest pain', 'heart', 'cardiac', 'angina', 'palpitation'],
    dermatology: ['rash', 'lesion', 'ulcer', 'skin'],
    neurology: ['headache', 'stroke', 'seizure', 'migraine'],
    pulmonology: ['shortness of breath', 'cough', 'asthma', 'copd', 'pneumonia']
  };
  let best = 'general', bestScore = 0;
  for (const [spec, kws] of Object.entries(map)) {
    const score = kws.filter(kw => text.includes(kw)).length;
    if (score > bestScore) { bestScore = score; best = spec; }
  }
  return best;
}

/**
 * GROUNDING VERIFICATION NODE - Check perceptual_state against raw inputs for hallucination
 */
function groundingVerificationNode(state) {
  const ps = state.perceptual_state;
  const raw = (state.raw_transcript || '').toLowerCase();
  const issues = [];

  if (!ps) return { perceptual_state: ps, requires_human_review: state.requires_human_review };

  for (const gf of ps.grounded_findings || []) {
    const finding = (gf.grounded_finding || '').toLowerCase();
    const hasImageEvidence = (gf.evidence?.image || []).length > 0;
    const hasTextEvidence = (gf.evidence?.text || []).length > 0;
    const inRaw = gf.evidence?.text?.some(t => raw.includes(String(t).toLowerCase())) || raw.includes(finding.split(/\s+/)[0]);
    if (hasTextEvidence && !hasImageEvidence && !inRaw && finding.length > 3) {
      issues.push(`Unverified entity: "${gf.grounded_finding}" not found in raw transcript`);
    }
    if (finding.includes('displaced') && !raw.includes('displac')) {
      issues.push(`Possible hallucination: "displaced" not in transcript`);
    }
    if (finding.includes('open fracture') && !raw.includes('open') && !raw.includes('compound')) {
      issues.push(`Possible hallucination: "open fracture" not clearly stated`);
    }
  }

  let requires_human_review = state.requires_human_review || { flag: false, reasons: [], severity: null };
  if (issues.length > 0) {
    requires_human_review = {
      flag: true,
      reasons: [...(requires_human_review.reasons || []), ...issues],
      severity: 'WARNING'
    };
  }
  return { requires_human_review };
}

/**
 * CONFIDENCE THRESHOLD NODE - Set requires_human_review if confidence < threshold
 */
function confidenceThresholdNode(state) {
  const ps = state.perceptual_state;
  const conf = ps?.confidence_score ?? 0;
  let requires_human_review = state.requires_human_review || { flag: false, reasons: [], severity: null };

  if (conf < CONFIDENCE_THRESHOLD) {
    requires_human_review = {
      flag: true,
      reasons: [...(requires_human_review.reasons || []), `Confidence ${conf.toFixed(2)} below threshold ${CONFIDENCE_THRESHOLD}`],
      severity: requires_human_review.severity || 'WARNING'
    };
  }
  const minVision = Math.min(...(state.visual_findings || []).map(f => f.confidence ?? 1), 1);
  const minEntity = state.clinical_entities?.length ? Math.min(...state.clinical_entities.map(e => e.confidence ?? 1)) : 1;
  if (minVision < CONFIDENCE_THRESHOLD && (state.visual_findings || []).length > 0) {
    requires_human_review = {
      flag: true,
      reasons: [...(requires_human_review.reasons || []), `Vision encoder confidence ${minVision.toFixed(2)} below threshold`],
      severity: 'WARNING'
    };
  }
  return { requires_human_review };
}

/**
 * AUDIT NODE - Log Fusion reasoning to decision_log
 */
function auditNode(state, db) {
  const audit = {
    call_id: state.callId,
    node: 'perception_fusion',
    input_summary: {
      visual_count: (state.visual_findings || []).length,
      text_symptoms: (state.textual_extraction?.symptoms || []).length,
      clinical_entities: (state.clinical_entities || []).length
    },
    output_summary: {
      grounded_findings: (state.perceptual_state?.grounded_findings || []).length,
      specialty: state.perceptual_state?.specialty,
      conflict_flag: state.perceptual_state?.conflict_flag,
      confidence: state.perceptual_state?.confidence_score
    },
    reasoning: state.fusion_reasoning || 'No fusion reasoning',
    requires_human_review: state.requires_human_review?.flag || false
  };
  if (db?.logDecision) {
    try {
      db.logDecision(
        state.callId,
        'perception_fusion',
        audit.input_summary,
        audit.output_summary,
        (audit.reasoning || '').slice(0, 4000)
      );
    } catch (e) {
      console.warn('⚠️  Perception audit log failed:', e.message);
    }
  }
  return { audit_log: [...(state.audit_log || []), audit] };
}

/**
 * Build and compile the Perception LangGraph
 */
async function buildPerceptionGraph(db) {
  const LG = await import('@langchain/langgraph').catch(() => null);
  if (!LG) return null;

  const { StateGraph, Annotation, START, END } = LG;
  const mergeObjectReducer = (left, right) => ({ ...(left || {}), ...(right || {}) });
  const requiresReviewReducer = (left, right) => {
    const a = left || { flag: false, reasons: [], severity: null };
    const b = right || { flag: false, reasons: [], severity: null };
    if (!b.flag) return a;
    return {
      flag: a.flag || b.flag,
      reasons: [...new Set([...(a.reasons || []), ...(b.reasons || [])])],
      severity: a.severity === 'CRITICAL' || b.severity === 'CRITICAL' ? 'CRITICAL' : (a.severity || b.severity)
    };
  };
  const PerceptionAnnotation = Annotation.Root({
    callId: Annotation(),
    modality: Annotation(),
    clinicId: Annotation(),
    raw_transcript: Annotation(),
    image_path: Annotation(),
    image_metadata: Annotation(),
    visual_findings: Annotation(),
    textual_extraction: Annotation(),
    clinical_entities: Annotation(),
    perceptual_state: Annotation(),
    fusion_reasoning: Annotation(),
    requires_human_review: Annotation({ reducer: requiresReviewReducer, default: () => ({ flag: false, reasons: [], severity: null }) }),
    processing_metadata: Annotation({ reducer: mergeObjectReducer, default: () => ({}) }),
    audit_log: Annotation()
  });

  const workflow = new StateGraph(PerceptionAnnotation)
    .addNode('vision', (state) => visionNode(state))
    .addNode('text', (state) => textNode(state))
    .addNode('clinical_bert', (state) => clinicalBertNode(state))
    .addNode('fusion', (state) => fusionNode(state))
    .addNode('grounding_verification', (state) => groundingVerificationNode(state))
    .addNode('confidence_threshold', (state) => confidenceThresholdNode(state))
    .addNode('audit', (state) => auditNode(state, db));

  workflow.addEdge(START, 'vision');
  workflow.addEdge(START, 'text');
  workflow.addEdge('text', 'clinical_bert');
  workflow.addEdge('vision', 'fusion');
  workflow.addEdge('clinical_bert', 'fusion');
  workflow.addEdge('fusion', 'grounding_verification');
  workflow.addEdge('grounding_verification', 'confidence_threshold');
  workflow.addEdge('confidence_threshold', 'audit');
  workflow.addEdge('audit', END);

  return workflow.compile();
}

/**
 * Run perception graph (or fallback to legacy buildPerceptualState)
 */
async function runPerceptionGraph(inputs, db) {
  const graph = await buildPerceptionGraph(db);
  if (!graph) {
    const { buildPerceptualState } = require('./perceptual-state-builder');
    return buildPerceptualState(inputs);
  }

  const initialState = createInitialState(inputs);
  const result = await graph.invoke(initialState);

  const ps = result.perceptual_state;
  if (!ps) return result;

  const rawText = result.raw_transcript || inputs.clinicalText || '';
  const negResult = textEncoder.extractNegativeFindings(rawText);
  const regionTag = result.clinicId ? require('./perceptual-state-builder').inferRegion(result.clinicId) : 'US';

  return {
    ...ps,
    call_id: inputs.callId,
    timestamp: new Date().toISOString(),
    modality: inputs.modality || 'text',
    visual_findings: ps.visual_findings || [],
    textual_findings: ps.textual_findings || [],
    expanded_text: result.textual_extraction?.normalized_text || rawText,
    specialty_tag: ps.specialty || 'general',
    region_tag: regionTag,
    negative_findings: negResult.exclusion_keywords || [],
    negative_phrases: (negResult.negative_findings || []).map(n => n.phrase).filter(Boolean),
    confidence_scores: { overall_confidence: ps.confidence_score ?? 0.5 },
    requires_human_review: result.requires_human_review || { flag: false, reasons: [] },
    processing_metadata: result.processing_metadata || {}
  };
}

module.exports = {
  createInitialState,
  buildPerceptionGraph,
  runPerceptionGraph,
  visionNode,
  textNode,
  clinicalBertNode,
  fusionNode,
  groundingVerificationNode,
  confidenceThresholdNode,
  auditNode,
  CONFIDENCE_THRESHOLD
};
