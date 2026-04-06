/**
 * Patient education query construction: lay ↔ clinical expansion + optional HyDE.
 * HyDE is gated for vague/short queries (harm reduction on synonym_gap_report-style noise).
 */

const fs = require('fs');
const path = require('path');

const EXPANSIONS_PATH = path.resolve(__dirname, '../../../Knowledge/rules/derm-lay-clinical-expansions.json');

const HYDE_RAW_WEIGHT = 0.5;
const HYDE_HYPOTHETICAL_WEIGHT = 0.5;
const DERM_EDU_HYDE_PROMPT = `You are a dermatology reference writer. Given a patient's question in plain language, write 2–3 sentences of neutral educational context as it might appear in a patient-information handout. Do not diagnose or prescribe. No brand names unless generic.`;

let expansionPairs = [];
try {
  if (fs.existsSync(EXPANSIONS_PATH)) {
    const j = JSON.parse(fs.readFileSync(EXPANSIONS_PATH, 'utf8'));
    expansionPairs = Array.isArray(j.pairs) ? j.pairs : [];
  }
} catch (e) {
  console.warn('[patient-education-query] Could not load derm-lay-clinical-expansions.json:', e.message);
}

function applyLayClinicalExpansion(text) {
  const t = (text || '').trim();
  if (!t) return { query: '', addedTerms: [] };
  const lower = t.toLowerCase();
  const added = new Set();
  for (const pair of expansionPairs) {
    const lay = pair.lay || [];
    const clinical = pair.clinical || [];
    const hit = lay.some((w) => lower.includes(String(w).toLowerCase()));
    if (hit) {
      clinical.forEach((c) => added.add(c));
    }
  }
  const terms = [...added];
  if (terms.length === 0) return { query: t, addedTerms: [] };
  return {
    query: `${t}\n\nRelated terms: ${terms.join(', ')}`.trim(),
    addedTerms: terms
  };
}

function blendQuery(rawText, hypotheticalText) {
  if (!hypotheticalText) return rawText;
  const targetLen = Math.min(2000, rawText.length + hypotheticalText.length);
  const rawChars = Math.floor(targetLen * HYDE_RAW_WEIGHT);
  const hypoChars = Math.floor(targetLen * HYDE_HYPOTHETICAL_WEIGHT);
  const rawPart = rawText.slice(0, Math.max(rawChars, 80));
  const hypoPart = hypotheticalText.slice(0, hypoChars);
  return `${rawPart}\n\nEducational context: ${hypoPart}`.trim();
}

async function generateHypotheticalEducation(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text || text.length < 15) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: process.env.DERM_EDU_HYDE_MODEL || process.env.TRIAGE_HYDE_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: DERM_EDU_HYDE_PROMPT },
          { role: 'user', content: text.slice(0, 2000) }
        ],
        max_tokens: 180,
        temperature: 0.25
      })
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(
        '[patient-education-query] HyDE API non-OK:',
        res.status,
        String(errBody || '').slice(0, 160)
      );
      return null;
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.warn('[patient-education-query] HyDE failed:', e.message);
    return null;
  }
}

function shouldSkipHyde(message, options = {}) {
  if (options.needs_clarification) return true;
  const t = (message || '').trim();
  if (t.length < 28) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 5) return true;
  if (process.env.DERM_EDU_HYDE === '0' || process.env.DERM_EDU_HYDE === 'false') return true;
  return false;
}

/**
 * Build query string and optional hybrid hints for passage retrieval.
 * @param {string} message - User message
 * @param {object} [options]
 * @param {boolean} [options.useHyde] - Force HyDE on/off (default: env + heuristics)
 * @param {boolean} [options.needs_clarification] - From triage; skips HyDE
 * @returns {Promise<{ query: string, hybrid: { dense_query: string, bm25_terms: string[] }, expansion_terms: string[] }>}
 */
async function buildPatientEducationQuery(message, options = {}) {
  const raw = (message || '').toString().trim();
  const expanded = applyLayClinicalExpansion(raw);
  let query = expanded.query;
  const bm25_terms = [...expanded.addedTerms];

  let denseQuery = query;
  const useHyde =
    options.useHyde === true ||
    (options.useHyde !== false && !shouldSkipHyde(raw, options) && !!process.env.OPENAI_API_KEY);

  if (useHyde) {
    const hypo = await generateHypotheticalEducation(raw);
    if (hypo) {
      query = blendQuery(expanded.query, hypo);
      denseQuery = blendQuery(expanded.query, hypo);
    }
  }

  return {
    query,
    hybrid: {
      dense_query: denseQuery,
      bm25_terms
    },
    expansion_terms: expanded.addedTerms
  };
}

module.exports = {
  buildPatientEducationQuery,
  applyLayClinicalExpansion,
  shouldSkipHyde
};
