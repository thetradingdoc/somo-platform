/**
 * CONTEXT ASSEMBLER SERVICE (Phase 2.4)
 *
 * Assembles prompt-ready context from conversation history and code candidates.
 * Used for RAG-style prompts to the coding LLM.
 */

const db = require('../database');
const knowledgeService = require('./knowledge-service');

// Context window limits
const MAX_CONVERSATION_TURNS = 10;
const MAX_ICD10_CANDIDATES = 20;
const CHARS_PER_TOKEN = 4;

/**
 * Rough token estimate (Section 9) - ~4 chars per token for LLM.
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Smart truncation (Section 9) - prefer segments with medical keywords; cap by token estimate.
 */
function smartTruncate(transcript, maxTokens = 2000) {
  if (!transcript || typeof transcript !== 'string') return '';
  if (estimateTokens(transcript) <= maxTokens) return transcript;

  const medicalKeywords = /\b(patient|symptom|pain|diagnosis|treatment|medication|blood pressure|temperature|chest|breath|fever|headache|injury|allergy|history|prescription|test|result|icd|cpt|code)\b/gi;
  const segments = transcript.split(/(?<=[.!?])\s+/);
  const scored = segments.map(s => ({
    text: s,
    score: (s.match(medicalKeywords) || []).length,
    tokens: estimateTokens(s)
  }));

  scored.sort((a, b) => b.score - a.score);
  let out = '';
  let tokens = 0;
  for (const seg of scored) {
    if (tokens + seg.tokens > maxTokens) break;
    out += (out ? ' ' : '') + seg.text;
    tokens += seg.tokens;
  }
  return out || transcript.slice(0, maxTokens * CHARS_PER_TOKEN);
}
const MAX_CPT_CANDIDATES = 15;
const MAX_HCPCS_CANDIDATES = 10;

/**
 * Assemble full context for coding: last N turns + code candidates for current query.
 * @param {string} callId - Voice call ID
 * @param {string} currentQuery - Current clinical note or user query
 * @param {Object} options - { includePatientHistory, includeInsurance, maxTurns, maxIcd10, maxCpt, maxHcpcs, useSemantic }
 * @returns {Promise<Object>} { conversationTurns, codeCandidates, icd10Candidates, cptCandidates, hcpcsCandidates, patientHistory, insuranceEligibility }
 */
async function assembleContext(callId, currentQuery, options = {}) {
  const tokenBudget = options.tokenBudget ?? 8000;
  let tokensReserved = 0;

  // Section 9: Smart truncate current query first (30% of budget for query)
  const queryBudget = Math.floor(tokenBudget * 0.3);
  const truncatedQuery = smartTruncate(currentQuery || '', queryBudget);
  tokensReserved += estimateTokens(truncatedQuery);

  // Dynamic turn limit from remaining budget
  const remainingForTurns = tokenBudget - tokensReserved;
  const avgTokensPerTurn = 150;
  const maxTurns = Math.min(
    MAX_CONVERSATION_TURNS,
    Math.max(1, Math.floor(remainingForTurns / avgTokensPerTurn))
  );

  let conversationTurns = [];
  if (callId && typeof db.getConversationHistory === 'function') {
    conversationTurns = db.getConversationHistory(callId, maxTurns);
    const convText = conversationTurns.map(t => t.content).join(' ');
    tokensReserved += estimateTokens(convText);
    if (tokensReserved > tokenBudget * 0.6 && conversationTurns.length > 1) {
      conversationTurns = conversationTurns.slice(0, Math.max(1, Math.floor(maxTurns / 2)));
    }
  }

  const maxIcd10 = options.maxIcd10 ?? MAX_ICD10_CANDIDATES;
  const maxCpt = options.maxCpt ?? MAX_CPT_CANDIDATES;
  const maxHcpcs = options.maxHcpcs ?? MAX_HCPCS_CANDIDATES;

  let codeCandidates = { icd10: [], cpt: [], hcpcs: [] };
  if (typeof knowledgeService.getCodeCandidates === 'function') {
    codeCandidates = await knowledgeService.getCodeCandidates(truncatedQuery, {
      maxIcd10,
      maxCpt,
      maxHcpcs,
      useSemantic: options.useSemantic,
      clinicId: options.clinicId,
      callId
    });
  }

  let patientHistory = null;
  if (options.includePatientHistory && (options.patientId || (callId && typeof db.getPatientIdForCall === 'function'))) {
    const patientId = options.patientId || db.getPatientIdForCall(callId);
    if (patientId && typeof db.getPatientCodingHistory === 'function') {
      try {
        patientHistory = db.getPatientCodingHistory(patientId, 10);
      } catch (_) {}
    }
  }

  tokensReserved += estimateTokens(
    (codeCandidates.icd10 || []).concat(codeCandidates.cpt || []).concat(codeCandidates.hcpcs || [])
      .map(c => `${c.code} ${c.description}`).join(' ')
  );

  const result = {
    conversationTurns,
    codeCandidates: codeCandidates.icd10?.concat(codeCandidates.cpt || []).concat(codeCandidates.hcpcs || []) || [],
    icd10Candidates: codeCandidates.icd10 || [],
    cptCandidates: codeCandidates.cpt || [],
    hcpcsCandidates: codeCandidates.hcpcs || [],
    patientHistory,
    insuranceEligibility: options.includeInsurance ? null : null,
    truncatedQuery,
    tokensUsed: tokensReserved,
    tokenBudget,
    budgetRemaining: Math.max(0, tokenBudget - tokensReserved)
  };

  if (options.includeInsurance && callId) {
    result.insuranceEligibility = null;
  }

  return result;
}

/**
 * Format assembled context as a string for LLM prompt injection.
 */
function formatContextForPrompt(context) {
  const parts = [];

  if (context.conversationTurns?.length > 0) {
    parts.push('## Conversation History');
    context.conversationTurns.forEach(t => {
      parts.push(`- ${t.role}: ${(t.content || '').slice(0, 500)}`);
    });
  }

  if (context.patientHistory?.length > 0) {
    parts.push('\n## Patient Coding History (prior encounters)');
    context.patientHistory.forEach((h, i) => {
      const icd = typeof h.icd10 === 'string' ? h.icd10 : (h.icd10 || '');
      const cpt = typeof h.cpt === 'string' ? h.cpt : (h.cpt || '');
      parts.push(`- Prior ${i + 1}: ICD-10 ${icd || '—'}, CPT ${cpt || '—'}${h.confidence ? ` (conf: ${h.confidence})` : ''}`);
    });
  }

  if (context.icd10Candidates?.length > 0) {
    parts.push('\n## ICD-10 Reference');
    context.icd10Candidates.forEach(c => {
      parts.push(`- ${c.code}: ${c.description}`);
    });
  }

  if (context.cptCandidates?.length > 0) {
    parts.push('\n## CPT Reference');
    context.cptCandidates.forEach(c => {
      parts.push(`- ${c.code}: ${c.description}`);
    });
  }

  if (context.hcpcsCandidates?.length > 0) {
    parts.push('\n## HCPCS Reference');
    context.hcpcsCandidates.forEach(c => {
      parts.push(`- ${c.code}: ${c.description}`);
    });
  }

  return parts.join('\n');
}

module.exports = {
  MAX_CONVERSATION_TURNS,
  MAX_ICD10_CANDIDATES,
  estimateTokens,
  smartTruncate,
  CHARS_PER_TOKEN,
  MAX_CPT_CANDIDATES,
  MAX_HCPCS_CANDIDATES,
  assembleContext,
  formatContextForPrompt
};
