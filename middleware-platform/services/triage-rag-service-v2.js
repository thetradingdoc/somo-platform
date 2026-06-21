/**
 * Triage RAG Service v2 (W2-S2.1, M-S2.B)
 *
 * Extends v1 with:
 * - HyDE blend: 45/55 raw/hypothetical ratio (M-S2.B) + medical textbook passage prompt
 * - Dual-source RAG: getCodeCandidatesDualSource (Colab + local) with useSemantic
 * - Optional rerank: rerankByPerceptualRelevance when candidates available
 *
 * When OPENAI_API_KEY set, generates hypothetical document and blends with raw query.
 */

const TriageRAGService = require('./triage-rag-service');
const knowledgeService = require('./knowledge-service');
const { normalizeForRAG } = require('../utils/signal-analysis');
const { rerankByPerceptualRelevance } = require('./layer2-rag/reranking-service');

const HYDE_RAW_WEIGHT = 0.45;
const HYDE_HYPOTHETICAL_WEIGHT = 0.55;
const MEDICAL_TEXTBOOK_PROMPT = `You are a medical reference. Given the following clinical summary from a triage intake, write a 2-3 sentence hypothetical paragraph as it might appear in a medical textbook when considering differential diagnoses. Use formal medical language. Do not make specific diagnoses. Only describe the clinical picture in textbook style.`;

async function generateHypotheticalDocument(clinicalText) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !clinicalText || clinicalText.length < 20) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: process.env.TRIAGE_HYDE_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: MEDICAL_TEXTBOOK_PROMPT },
          { role: 'user', content: clinicalText.slice(0, 2000) }
        ],
        max_tokens: 150,
        temperature: 0.3
      })
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.warn('[TriageRAGv2] HyDE generation failed:', e.message);
    return null;
  }
}

/** M-S2.B: 45/55 raw/hypothetical ratio — blended query composition */
function blendQuery(rawText, hypotheticalText) {
  if (!hypotheticalText) return rawText;
  const targetLen = Math.min(1500, rawText.length + hypotheticalText.length);
  const rawChars = Math.floor(targetLen * HYDE_RAW_WEIGHT);
  const hypoChars = Math.floor(targetLen * HYDE_HYPOTHETICAL_WEIGHT);
  const rawPart = rawText.slice(0, Math.max(rawChars, 100));
  const hypoPart = hypotheticalText.slice(0, hypoChars);
  return `${rawPart}\n\nRelevant clinical context (textbook style): ${hypoPart}`.trim();
}

class TriageRAGServiceV2 {
  /**
   * Phase 5 adapter: same structured contract used by query planner.
   */
  static async enrichFromStructuredInput(input = {}) {
    const out = await this.enrichFromSymptoms({
      sessionId: input.sessionId,
      symptomText: input.symptomText || '',
      opqrst: input.opqrst || {},
      richIntake: input.richIntake || {},
      patientId: input.patientId || null,
      clinicId: input.clinicId || null
    });
    return { ...out, confidence: out?.rag_confidence ?? null };
  }

  /**
   * Same interface as TriageRAGService.enrichFromSymptoms.
   * Uses dual-source RAG + HyDE when available.
   */
  static async enrichFromSymptoms(params) {
    const { sessionId, symptomText, opqrst = {}, richIntake = {}, patientId = null, clinicId = null } = params;

    let combinedText = TriageRAGService._buildCombinedText(symptomText, opqrst, richIntake);
    combinedText = normalizeForRAG(combinedText);

    let queryForRAG = combinedText;
    const hydeEnabled = String(process.env.TRIAGE_HYDE_ENABLED ?? '1').trim() !== '0';
    if (hydeEnabled && process.env.OPENAI_API_KEY) {
      const hypothetical = await generateHypotheticalDocument(combinedText);
      queryForRAG = blendQuery(combinedText, hypothetical);
    }

    const useDualSource = typeof knowledgeService.getCodeCandidatesDualSource === 'function';
    let icdCodes = [];
    let cptCodes = [];
    /** True if at least one knowledge call completed without throw (empty arrays OK). */
    let knowledgeFetchSucceeded = false;
    const remoteTimeoutMs = parseInt(process.env.REMOTE_RAG_TIMEOUT_MS || '8000', 10);

    let codingProvenance = params._codingProvenance || null;

    if (useDualSource) {
      try {
        const result = await knowledgeService.getCodeCandidatesDualSource(queryForRAG, {
          maxIcd10: 5,
          maxCpt: 3,
          clinicId,
          callId: sessionId,
          specialty: 'general',
          remoteTimeoutMs,
          useSemantic: process.env.EVAL_USE_SEMANTIC !== 'false'
        });
        icdCodes = result?.icd10 || result?.merged_codes?.icd10 || [];
        cptCodes = result?.cpt || result?.merged_codes?.cpt || [];
        knowledgeFetchSucceeded = true;
        codingProvenance = {
          confidence_breakdown: result.confidence_breakdown,
          remote_source: result.remote_knowledge?.metadata?.source || 'none',
          local_source: result.local_knowledge?.metadata?.source || 'local'
        };
      } catch (e) {
        console.warn('[TriageRAGv2] Dual-source failed, falling back to v1:', e.message);
      }
    }

    if (icdCodes.length === 0 && cptCodes.length === 0) {
      try {
        const ragResult = await knowledgeService.getCodeCandidates(queryForRAG, {
          maxIcd10: 5,
          maxCpt: 3,
          clinicId,
          callId: sessionId,
          useSemantic: true
        });
        icdCodes = ragResult?.icd10 || [];
        cptCodes = ragResult?.cpt || [];
        knowledgeFetchSucceeded = true;
      } catch (e) {
        console.warn('[TriageRAGv2] knowledge-service unavailable:', e.message);
      }
    }

    // W2-S2.1: Optional rerank by clinical relevance (combinedText as fallback query)
    try {
      const icdCands = (icdCodes || []).map(c => ({ ...c, code_type: 'icd10' }));
      const cptCands = (cptCodes || []).map(c => ({ ...c, code_type: 'cpt' }));
      const allCandidates = [...icdCands, ...cptCands];
      if (allCandidates.length > 0) {
        const reranked = rerankByPerceptualRelevance(allCandidates, null, combinedText, 10);
        const newIcd = reranked.filter(r => r.code_type === 'icd10').map(({ code_type, ...r }) => r);
        const newCpt = reranked.filter(r => r.code_type === 'cpt').map(({ code_type, ...r }) => r);
        if (newIcd.length) icdCodes = newIcd;
        if (newCpt.length) cptCodes = newCpt;
      }
    } catch (e) {
      // Rerank optional; keep original order on failure
    }

    // If every knowledge attempt threw, defer to V1's getCodeCandidates (do not pass empty override).
    if (!knowledgeFetchSucceeded) {
      return TriageRAGService.enrichFromSymptoms({
        ...params,
        _ragResultOverride: null,
        _skipKnowledgeService: false
      });
    }
    // Successful fetch (possibly empty codes): pass override so V1 does not duplicate the call.
    return TriageRAGService.enrichFromSymptoms({
      ...params,
      _ragResultOverride: { icdCodes, cptCodes },
      _codingProvenance: codingProvenance,
      _skipKnowledgeService: false
    });
  }
}

module.exports = TriageRAGServiceV2;
