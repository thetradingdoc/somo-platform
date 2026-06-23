const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// LangSmith: support AP_Langchain as fallback for LANGSMITH_API_KEY (MUST HAVE for tracking)
if (!process.env.LANGSMITH_API_KEY && process.env.AP_Langchain) {
  process.env.LANGSMITH_API_KEY = process.env.AP_Langchain;
}
if (process.env.LANGSMITH_API_KEY && process.env.LANGCHAIN_TRACING_V2 !== 'false') {
  process.env.LANGCHAIN_TRACING_V2 = 'true';
}

const Groq = require('groq-sdk');
const knowledgeService = require('../shared/knowledge-service');
const db = require('../../database');
const featureFlags = require('../../utils/feature-flags');
const { getOrCreate, GROQ } = require('../../utils/circuit-breaker');
const tokenBudget = require('../../utils/token-budget');

const groqBreaker = getOrCreate(GROQ, { failureThreshold: 5, windowMs: 60000, resetTimeMs: 30000 });

// Groq 429 retry (Section 17): exponential backoff 1s, 2s, 4s; max 3 retries
const GROQ_429_RETRIES = 3;
const GROQ_429_BACKOFF_MS = [1000, 2000, 4000];

// Optional LangChain for LangSmith tracing
let ChatGroq = null;
let HumanMessage = null;
let SystemMessage = null;
try {
  const groqPkg = require('@langchain/groq');
  const corePkg = require('@langchain/core/messages');
  ChatGroq = groqPkg.ChatGroq;
  HumanMessage = corePkg.HumanMessage;
  SystemMessage = corePkg.SystemMessage;
} catch (_) {
  // LangChain not available, will use raw Groq SDK
}

// Make Groq optional - only initialize if API key is available
let groq = null;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (GROQ_API_KEY) {
  try {
    groq = new Groq({ apiKey: GROQ_API_KEY });
    console.log('✅ Groq configured - Medical coding AI enabled');
    if (ChatGroq && process.env.LANGCHAIN_TRACING_V2 === 'true') {
      console.log('✅ LangSmith tracing enabled (LANGSMITH_API_KEY/AP_Langchain)');
    }
  } catch (error) {
    console.warn('⚠️  Groq initialization failed:', error.message);
    groq = null;
  }
} else {
  console.warn('⚠️  GROQ_API_KEY not set - Medical coding AI features will be disabled');
  console.warn('   Set GROQ_API_KEY in environment variables to enable AI-powered medical coding');
}

const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Confidence thresholds (P0 - Section 5)
const CONFIDENCE_THRESHOLD_LOW = parseFloat(process.env.CONFIDENCE_THRESHOLD_LOW || '0.6');
const CONFIDENCE_THRESHOLD_ESCALATE = parseFloat(process.env.CONFIDENCE_THRESHOLD_ESCALATE || '0.75');

// Rough cost per 1M tokens (Groq Llama-3.3-70B)
const COST_PER_1M_INPUT = 0.59;
const COST_PER_1M_OUTPUT = 0.79;

/**
 * Build evidence trace from cross_modal_links for defensible justification
 */
function buildEvidenceTrace(perceptualState, llmRationale) {
  const links = perceptualState?.cross_modal_links || [];
  if (links.length === 0) {
    return { rationale: llmRationale, links: [] };
  }
  const evidenceLines = links
    .filter((l) => l.alignment_score > 0 && l.supporting_evidence)
    .map((l) => `- ${l.text_concept} ↔ ${l.visual_finding || 'N/A'} (align=${l.alignment_score}): ${l.supporting_evidence}`);
  const evidenceBlock = evidenceLines.length
    ? `\n\nEvidence (cross-modal links):\n${evidenceLines.join('\n')}`
    : '';
  return {
    rationale: (llmRationale || '').trim() + evidenceBlock,
    links
  };
}

/**
 * Compute overall coding confidence (min of all code confidences, or 0.85 if single code)
 */
function computeOverallConfidence(icd10 = [], cpt = []) {
  const all = [...icd10, ...cpt].filter(Boolean);
  if (all.length === 0) return 0.5;
  const confidences = all.map(c => knowledgeService.ensureCodeConfidence(c, 0.8));
  return Math.min(...confidences);
}

/**
 * Build fallback result from knowledge service (extracted to avoid duplication).
 * Used when Groq is unavailable, cost cap exceeded, or token budget exceeded.
 * 
 * @param {string} clinicalNote - Clinical note text
 * @param {Object} perceptualState - Perceptual state (optional)
 * @param {string} reason - Reason for fallback (e.g., 'Groq unavailable', 'cost cap exceeded')
 * @param {Object} options - { costCapExceeded?: boolean }
 * @returns {Promise<Object>} Coding result with ICD-10 and CPT codes
 */
async function buildFallbackResult(clinicalNote, perceptualState, reason, options = {}) {
  const fallback = perceptualState
    ? await knowledgeService.getCandidatesForCoding(clinicalNote, { perceptualState, limitCpt: 5, limitIcd10: 3 })
    : {
        cpt: knowledgeService.getCandidateCptCodes(clinicalNote, { limit: 5 }),
        icd10: knowledgeService.getReferenceIcdCodes(3, options.costCapExceeded ? 0.65 : 0.7)
      };
  
  const cptCandidates = fallback.cpt;
  const icdReference = fallback.icd10;
  const cptWithConf = (cptCandidates.slice(0, 1) || []).map(c => ({
    ...c,
    confidence: typeof c.confidence === 'number' ? c.confidence : (options.costCapExceeded ? 0.65 : 0.7)
  }));
  const icdWithConf = icdReference.map(icd => ({ 
    ...icd, 
    confidence: icd.confidence ?? (options.costCapExceeded ? 0.65 : 0.7) 
  }));

  const codesToValidate = {
    icd10: icdWithConf.map(c => c.code).filter(Boolean),
    cpt: cptWithConf.map(c => c.code).filter(Boolean)
  };
  const trustRag = !!(process.env.RAG_API_URL && process.env.RAG_API_URL.trim());
  const validation = knowledgeService.validateCodesExist(codesToValidate, {
    trustExternalSource: trustRag,
    trustFormattedCodes: true
  });
  let validIcd = icdWithConf;
  let validCpt = cptWithConf;
  if (!validation.valid) {
    validIcd = icdWithConf.filter(c => !validation.invalid.icd10.includes(c.code));
    validCpt = cptWithConf.filter(c => !validation.invalid.cpt.includes(c.code));
  }
  const conf = computeOverallConfidence(validIcd, validCpt);

  return {
    icd10: validIcd,
    cpt: validCpt,
    rationale: `${reason} Using knowledge-service fallback.`,
    model: 'knowledge-service-fallback',
    raw: null,
    promptContext: { cptCandidates, icdReference },
    codingConfidence: conf,
    needsReview: conf < CONFIDENCE_THRESHOLD_ESCALATE,
    ...(options.costCapExceeded && { costCapExceeded: true })
  };
}

/** Heuristic: PDF/text is likely a radiology or ultrasound report (for CPT hints). */
function noteLooksLikeRadiologyImaging(note) {
  if (!note || typeof note !== 'string') return false;
  const n = note.toLowerCase();
  return (
    /\b(sonograph|sonography|ultrasound|echogenic|radiologist|radiology)\b/.test(n) ||
    /\bdiagnostic\s+imaging\b/.test(n) ||
    /\b(us|u\/s)\s+abdomen\b|\babdomen(al)?\s+(us|ultrasound)\b/.test(n)
  );
}

/**
 * Prepend common abdominal ultrasound CPTs when the note looks like an imaging report
 * so the model sees procedure options even if keyword CPT search returned none.
 */
function mergeRadiologyCptCandidates(note, candidates) {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  if (!noteLooksLikeRadiologyImaging(note)) return list;
  const existing = new Set(list.map(c => String(c.code || '').trim()).filter(Boolean));
  const hints = [
    { code: '76700', description: 'Ultrasound, abdominal, complete (real time with image documentation)' },
    { code: '76705', description: 'Ultrasound, abdominal, limited' }
  ];
  const prepend = [];
  for (const h of hints) {
    if (!existing.has(h.code)) prepend.push({ ...h, confidence: typeof h.confidence === 'number' ? h.confidence : 0.72 });
  }
  return [...prepend, ...list];
}

function buildPrompt({ clinicalNote, encounterType, patientContext, cptCandidates, icdReference, perceptualState, retrievedGuidelines }) {
  const cptSection = cptCandidates.length
    ? cptCandidates.map(item => `${item.code}: ${item.description}`).join('\n')
    : 'No candidate CPT codes found';
  const icdSection = icdReference.length
    ? icdReference.map(item => `${item.code}: ${item.description}`).join('\n')
    : 'No ICD-10 reference codes available';

  let perceptualSection = '';
  let evidenceInstruction = '';

  if (perceptualState && (perceptualState.visual_findings?.length > 0 || perceptualState.cross_modal_links?.length > 0)) {
    const vf = perceptualState.visual_findings || [];
    const txt = perceptualState.textual_findings || [];
    const links = perceptualState.cross_modal_links || [];
    const specialty = perceptualState.specialty_tag || 'general';

    perceptualSection = `
---
EVIDENCE PACKAGE (Perceptual State - use as grounding truth):
The patient's clinical note has been analyzed alongside imaging. Use VISUAL FINDINGS as the primary diagnostic driver when available.

Visual Findings (from imaging):
${vf.length ? vf.map(f => `- ${f.finding} @ ${f.body_region || 'N/A'} (${f.laterality || 'N/A'}) confidence=${f.confidence} evidence=${f.evidence_strength || 'N/A'}`).join('\n') : '(none)'}

Textual Findings (from clinical note):
${txt.length ? txt.map(f => `- ${f.concept}: ${f.mention || '-'} (${f.severity || 'N/A'})`).join('\n') : '(none)'}

Cross-Modal Links (text ↔ image alignment):
${links.length ? links.map(l => `- "${l.text_concept}" ↔ "${l.visual_finding || 'N/A'}" alignment=${l.alignment_score} type=${l.alignment_type} evidence: ${l.supporting_evidence || 'N/A'}`).join('\n') : '(none)'}

Specialty context: ${specialty}
---
`;

    evidenceInstruction = `
CRITICAL: Prioritize visual findings over text when both exist. For each ICD-10 code you select, cite the supporting evidence from the cross-modal links above. Your rationale MUST reference which visual finding and/or textual finding supports each code.
`;
  }

  const guidelinesSection = retrievedGuidelines && retrievedGuidelines.length > 0
    ? `\nRelevant Guidelines:\n${retrievedGuidelines.slice(0, 5).map(g => typeof g === 'string' ? g : g.text || g).join('\n---\n')}\n`
    : '';

  const imagingSection = noteLooksLikeRadiologyImaging(clinicalNote)
    ? `
IMAGING / RADIOLOGY: If this document describes a performed imaging study (e.g. abdominal ultrasound, sonography), include the most specific standard AMA CPT for that study when it is clearly the procedure documented (e.g. complete vs limited abdomen US). Prefer a listed CPT candidate when it matches; otherwise still output the best-matching 5-digit CPT.
Use ICD-10-CM codes supported by the findings and impression (not abbreviations like "BPH" alone — use N40.1 when benign prostatic hyperplasia is documented).
`
    : '';

  return `You are a certified medical coding specialist. Review the clinical note and select appropriate codes.
Respond with JSON: {"icd10": [{"code": "...", "description": "...", "confidence": 0.0-1.0}], "cpt": [{"code": "...", "description": "...", "confidence": 0.0-1.0, "modifiers": ["-25", "-59", "-51"]}], "rationale": "..."}
Include modifiers when applicable: -25 when E/M and procedure same visit (on E/M); -59 when distinct procedures; -51 when multiple surgery.
Prefer CPT and ICD-10 codes from the candidate/reference lists when they fit the documentation. You MUST still output clinically accurate ICD-10-CM and CPT codes supported by the note even when the lists are incomplete (e.g. a valid code not shown in the list). Use standard US ICD-10-CM formatting (letter + digits + optional dot extension). Return empty arrays only when truly no defensible code applies.
${imagingSection}
${evidenceInstruction}

Clinical Note:
${clinicalNote}

Encounter: ${encounterType || 'Unknown'}
${perceptualSection}${guidelinesSection}

CPT Candidates:
${cptSection}

ICD-10 Reference:
${icdSection}
`;
}

async function callGroqWithRetry(fn) {
  let lastErr;
  for (let i = 0; i <= GROQ_429_RETRIES; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const is429 = err.status === 429 || err.statusCode === 429 ||
      (err.response && err.response.status === 429) ||
      (err.message && /rate limit|429/i.test(err.message));
      if (is429 && i < GROQ_429_RETRIES) {
        const delay = GROQ_429_BACKOFF_MS[i];
        console.warn(`⚠️  Groq 429 - retry ${i + 1}/${GROQ_429_RETRIES} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

async function callGroqRaw({ systemContent, userContent }) {
  return groqBreaker.execute(() =>
    callGroqWithRetry(() => groq.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      temperature: 0.2
    }))
  );
}

async function callGroqLangChain({ systemContent, userContent, callId, clinicId, operation = 'suggest_codes' }) {
  return groqBreaker.execute(() =>
    callGroqWithRetry(async () => {
  const model = new ChatGroq({
    apiKey: GROQ_API_KEY,
    model: DEFAULT_MODEL,
    temperature: 0.2,
    streaming: false,
    response_format: { type: 'json_object' }
  });
  const tags = ['medical-coding', 'somo', operation];
  if (clinicId) tags.push(`clinic:${clinicId}`);
  if (callId) tags.push(`call:${callId}`);
  const runnableConfig = {
    runName: `medical_coding_${operation}`,
    tags,
    metadata: { clinic_id: clinicId || null, call_id: callId || null, operation }
  };
  const res = await model.invoke([
    new SystemMessage(systemContent),
    new HumanMessage(userContent)
  ], runnableConfig);
  const content = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content || {});
  const usage = res?.response_metadata?.usage || res?.usage_metadata || {};
  return {
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? usage.completion_tokens ?? 0
    }
  };
    })
  );
}

async function generateCodingSuggestion({ clinicalNote, encounterType, patientContext, perceptualState, retrievedGuidelines, callId, clinicId }) {
  if (!clinicalNote || typeof clinicalNote !== 'string') {
    throw new Error('Clinical note is required for coding suggestions');
  }

  // Standalone (PDF/orchestrator): reset token count so each request gets full budget
  if (!callId) tokenBudget.reset('standalone');

  if (!groq) {
    console.warn('⚠️  Groq not available - using knowledge service fallback for medical coding');
    return await buildFallbackResult(clinicalNote, perceptualState, 'Groq AI unavailable');
  }

  const MAX_NOTE_LENGTH = 4000;
  const truncatedNote = clinicalNote.length > MAX_NOTE_LENGTH
    ? clinicalNote.slice(-MAX_NOTE_LENGTH) + '\n[... previous content truncated ...]'
    : clinicalNote;

  const { cpt: cptCandidates, icd10: icdReference } = perceptualState
    ? await knowledgeService.getCandidatesForCoding(truncatedNote, {
        perceptualState,
        limitCpt: 10,
        limitIcd10: 12
      })
    : {
        cpt: knowledgeService.getCandidateCptCodes(truncatedNote, { limit: 10 }),
        icd10: knowledgeService.getReferenceIcdCodes(12)
      };

  const cptCandidatesForPrompt = mergeRadiologyCptCandidates(truncatedNote, cptCandidates);

  const prompt = buildPrompt({
    clinicalNote: truncatedNote,
    encounterType,
    patientContext,
    cptCandidates: cptCandidatesForPrompt,
    icdReference,
    perceptualState,
    retrievedGuidelines
  });
  const systemContent = 'You are a certified medical coder. Always follow AMA and CMS guidelines. Respond with valid JSON only.';

  // Monthly cost cap (Section 10): block Groq if clinic exceeded cap
  if (clinicId && typeof db.getClinicMonthlyLlmCost === 'function' && typeof db.getClinicMonthlyCostCap === 'function') {
    const costRow = db.getClinicMonthlyLlmCost(clinicId);
    const cap = db.getClinicMonthlyCostCap(clinicId);
    if (cap != null && cap > 0 && (costRow?.cost_usd ?? 0) >= cap) {
      console.warn(`⚠️  Clinic ${clinicId} monthly LLM cost cap exceeded (${costRow?.cost_usd ?? 0} >= ${cap}) - using knowledge-service fallback`);
      return await buildFallbackResult(truncatedNote, perceptualState, 'Monthly cost cap exceeded', { costCapExceeded: true });
    }
  }

  // Token budget (Section 10): skip Groq if call would exceed limit
  const estimatedTokens = tokenBudget.estimateTokens(prompt) + tokenBudget.estimateTokens(systemContent) + 2500; // ~2k output
  if (!tokenBudget.canProceed(callId, estimatedTokens)) {
    console.warn(`⚠️  Token budget exceeded for call ${callId || 'standalone'} - using knowledge-service fallback`);
    return await buildFallbackResult(truncatedNote, perceptualState, 'Token budget exceeded');
  }

  try {
    const startMs = Date.now();
    // MUST HAVE: Always use LangChain when available so traces go to LangSmith
    const useLangChain = ChatGroq && process.env.LANGCHAIN_TRACING_V2 !== 'false';
    const response = useLangChain
      ? await callGroqLangChain({ systemContent, userContent: prompt, callId, clinicId, operation: 'suggest_codes' })
      : await callGroqRaw({ systemContent, userContent: prompt });
    const latencyMs = Date.now() - startMs;

    const usage = response?.usage || {};
    const tokensIn = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const tokensOut = usage.completion_tokens ?? usage.output_tokens ?? 0;
    tokenBudget.addTokens(callId, { prompt_tokens: tokensIn, completion_tokens: tokensOut });
    const costUsd = (tokensIn / 1e6) * COST_PER_1M_INPUT + (tokensOut / 1e6) * COST_PER_1M_OUTPUT;

    let parsed;
    let message = response?.choices?.[0]?.message?.content;
    if (typeof message === 'string' && message.includes('```')) {
      const match = message.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) message = match[1].trim();
    }
    try {
      parsed = message ? JSON.parse(message) : null;
    } catch (error) {
      throw new Error(`Failed to parse Groq response: ${error.message}`);
    }

    const icd10 = (Array.isArray(parsed?.icd10) ? parsed.icd10 : []).map(icd => ({
      ...icd,
      confidence: knowledgeService.ensureCodeConfidence(icd, 0.85)
    }));
    const cpt = (Array.isArray(parsed?.cpt) ? parsed.cpt : []).map(c => ({
      ...c,
      confidence: knowledgeService.ensureCodeConfidence(c, 0.85),
      modifiers: Array.isArray(c.modifiers) ? c.modifiers.map(m => String(m).trim()) : []
    }));

    const codingConfidence = computeOverallConfidence(icd10, cpt);

    // Mandatory validation: filter out any code not in KB (Section 6)
    // When RAG is configured, trust well-formatted codes from RAG even if not in local DB
    const codesToValidate = {
      icd10: icd10.map(c => (typeof c === 'object' ? c.code : c)).filter(Boolean),
      cpt: cpt.map(c => (typeof c === 'object' ? c.code : c)).filter(Boolean)
    };
    const trustRagCodes = !!(process.env.RAG_API_URL && process.env.RAG_API_URL.trim());
    // LLM often returns valid ICD-10-CM/CPT not present in the local SQLite slice; trusting canonical
    // format avoids empty claims when RAG_API_URL is unset (RAG retrieval is separate from this gate).
    const validation = knowledgeService.validateCodesExist(codesToValidate, {
      trustExternalSource: trustRagCodes,
      trustFormattedCodes: true
    });
    let validIcd10 = icd10;
    let validCpt = cpt;
    if (!validation.valid) {
      validIcd10 = icd10.filter(c => !validation.invalid.icd10.includes(typeof c === 'object' ? c.code : c));
      validCpt = cpt.filter(c => !validation.invalid.cpt.includes(typeof c === 'object' ? c.code : c));
      if (validation.invalid.icd10.length || validation.invalid.cpt.length) {
        console.warn('⚠️  Filtered invalid codes:', validation.invalid);
      }
    }
    const finalConfidence = computeOverallConfidence(validIcd10, validCpt);

    // Confidence thresholds: reject <0.6, escalate 0.6-0.75 (Section 5)
    // Feature flag: confidence_rejection_enabled (default true)
    if (featureFlags.isEnabled('confidence_rejection_enabled', clinicId) && finalConfidence < CONFIDENCE_THRESHOLD_LOW) {
    const rejTrace = buildEvidenceTrace(perceptualState, parsed?.rationale || '');
    return {
      icd10: [],
      cpt: [],
      rationale: rejTrace.rationale,
      evidenceTrace: rejTrace.links,
      model: DEFAULT_MODEL,
      raw: parsed,
      rejected: true,
      reason: 'low_confidence',
      escalateToHuman: true,
      codingConfidence: finalConfidence,
      promptContext: { cptCandidates: cptCandidatesForPrompt, icdReference }
    };
    }
    if (finalConfidence < CONFIDENCE_THRESHOLD_ESCALATE) {
      console.warn(`⚠️  Coding confidence ${finalConfidence.toFixed(2)} in escalate range - consider human review`);
    }

    if (typeof db.insertLlmUsageLog === 'function') {
      try {
        db.insertLlmUsageLog({
          call_id: callId || null,
          clinic_id: clinicId || null,
          operation: 'medical_coding',
          model: DEFAULT_MODEL,
          tokens_in: tokensIn || null,
          tokens_out: tokensOut || null,
          cost_usd: costUsd > 0 ? Math.round(costUsd * 1e6) / 1e6 : null,
          latency_ms: latencyMs,
          confidence_score: finalConfidence
        });
      } catch (logErr) {
        console.warn('⚠️  llm_usage_log insert failed:', logErr.message);
      }
    }

    if (callId && typeof db.logDecision === 'function') {
      try {
        db.logDecision(callId, 'code', { candidates: cptCandidatesForPrompt?.length, icd_ref: icdReference?.length }, { icd10: validIcd10?.length, cpt: validCpt?.length, confidence: finalConfidence }, (parsed?.rationale || '').slice(0, 500));
      } catch (_) {}
    }

    const rationale = parsed?.rationale || '';
    const evidenceTrace = buildEvidenceTrace(perceptualState, rationale);

    return {
      icd10: validIcd10,
      cpt: validCpt,
      rationale: evidenceTrace.rationale,
      evidenceTrace: evidenceTrace.links,
      model: DEFAULT_MODEL,
      raw: parsed,
      promptContext: { cptCandidates: cptCandidatesForPrompt, icdReference },
      codingConfidence: finalConfidence,
      needsReview: finalConfidence < CONFIDENCE_THRESHOLD_ESCALATE
    };
  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ Groq API error:', error.status || error.code || 'Unknown', errorDetails);

    if (error.message?.includes('max completion tokens') || error.message?.includes('json_validate_failed')) {
      console.warn('⚠️  Token limit reached - consider truncating clinical note further or reducing candidate codes');
    }

    console.warn('⚠️  Falling back to knowledge service due to Groq error');
    return await buildFallbackResult(clinicalNote, perceptualState, `Groq AI error: ${error.message}`);
  }
}

/**
 * LangSmith status for health check (Section 25).
 * @returns {{ enabled: boolean, project: string, hasKey: boolean }}
 */
function getLangSmithStatus() {
  let projectId = null;
  try {
    const cfg = require('../../utils/langsmith-config');
    projectId = cfg.DOCTOR_LITTLE_PROJECT;
  } catch (_) { /* ignore */ }
  const key = process.env.LANGSMITH_API_KEY || process.env.AP_Langchain;
  const project = process.env.LANGCHAIN_PROJECT || process.env.LANGSMITH_PROJECT || projectId || 'middleware-default';
  const tracingOn = process.env.LANGCHAIN_TRACING_V2 === 'true';
  return {
    enabled: !!(key && tracingOn),
    project,
    projectId: projectId || project,
    hasKey: !!key,
    traceUrl: project ? `https://smith.langchain.com/projects` : null
  };
}

module.exports = {
  generateCodingSuggestion,
  getLangSmithStatus,
  computeOverallConfidence
};
