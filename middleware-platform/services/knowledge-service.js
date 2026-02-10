const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../database');
const cache = require('./cache-service');
const { buildSearchQuery, buildSearchIntent } = require('./layer2-rag/search-intent-builder');

const ICD_REFERENCE_PATH = path.resolve(__dirname, '../../Knowledge/ICD-10 Files/icd10_reference.json');
const ICD_REFERENCE_PATH_FALLBACK = path.resolve(__dirname, '../../Knowledge/icd10_reference.json');
const SIMPLE_RULES_PATH = path.resolve(__dirname, '../../Knowledge/rules/simple-coding-rules.json');
const TRIAGE_RULES_PATH = path.resolve(__dirname, '../../Knowledge/rules/triage-rules.json');
const MEDICAL_ABBREVIATIONS_PATH = path.resolve(__dirname, '../../Knowledge/ontology/medical-abbreviations.json');
const MEDICAL_ENTITIES_PATH = path.resolve(__dirname, '../../Knowledge/ontology/medical-entities.json');
const EXTRACTION_PATTERNS_PATH = path.resolve(__dirname, '../../Knowledge/ontology/extraction-patterns.json');
let icdCache = [];
let simpleRules = [];
let medicalAbbreviations = {};
let triageRules = null;
let medicalEntities = null;
let extractionPatterns = null;

try {
  const icdPath = fs.existsSync(ICD_REFERENCE_PATH)
    ? ICD_REFERENCE_PATH
    : (fs.existsSync(ICD_REFERENCE_PATH_FALLBACK) ? ICD_REFERENCE_PATH_FALLBACK : null);
  if (icdPath) {
    const raw = fs.readFileSync(icdPath, 'utf8');
    icdCache = JSON.parse(raw);
    console.log(`✅ Loaded ICD-10 reference: ${icdCache.length} codes from ${path.basename(icdPath)}`);
  }
} catch (error) {
  console.warn('⚠️  Failed to load ICD reference list:', error.message);
  icdCache = [];
}

try {
  if (fs.existsSync(SIMPLE_RULES_PATH)) {
    const raw = fs.readFileSync(SIMPLE_RULES_PATH, 'utf8');
    simpleRules = JSON.parse(raw);
  }
} catch (error) {
  console.warn('⚠️  Failed to load simple coding rules:', error.message);
  simpleRules = [];
}

try {
  if (fs.existsSync(MEDICAL_ABBREVIATIONS_PATH)) {
    const raw = fs.readFileSync(MEDICAL_ABBREVIATIONS_PATH, 'utf8');
    medicalAbbreviations = JSON.parse(raw);
    const count = Object.keys(medicalAbbreviations).length;
    if (count > 0) console.log(`✅ Loaded medical abbreviations: ${count} entries`);
  }
} catch (error) {
  console.warn('⚠️  Failed to load medical abbreviations:', error.message);
  medicalAbbreviations = {};
}

function loadTriageRules() {
  if (triageRules !== null) return triageRules;
  triageRules = { emergent: [], urgent: [] };
  try {
    if (fs.existsSync(TRIAGE_RULES_PATH)) {
      const raw = fs.readFileSync(TRIAGE_RULES_PATH, 'utf8');
      triageRules = JSON.parse(raw);
      const e = (triageRules.emergent || []).length;
      const u = (triageRules.urgent || []).length;
      if (e + u > 0) console.log(`✅ Loaded triage rules: ${e} emergent, ${u} urgent`);
    }
  } catch (e) {
    console.warn('⚠️  Failed to load triage rules:', e.message);
  }
  return triageRules;
}

function loadMedicalEntities() {
  if (medicalEntities !== null) return medicalEntities;
  medicalEntities = { symptoms: {}, body_locations: {}, severity_indicators: {}, temporal_patterns: {} };
  try {
    if (fs.existsSync(MEDICAL_ENTITIES_PATH)) {
      const raw = fs.readFileSync(MEDICAL_ENTITIES_PATH, 'utf8');
      medicalEntities = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('⚠️  Failed to load medical entities:', e.message);
  }
  return medicalEntities;
}

function loadExtractionPatterns() {
  if (extractionPatterns !== null) return extractionPatterns;
  extractionPatterns = { symptoms: [], vitals: [], temporal: [], severity: [] };
  try {
    if (fs.existsSync(EXTRACTION_PATTERNS_PATH)) {
      const raw = fs.readFileSync(EXTRACTION_PATTERNS_PATH, 'utf8');
      extractionPatterns = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('⚠️  Failed to load extraction patterns:', e.message);
  }
  return extractionPatterns;
}

const DEFAULT_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'patient', 'presents', 'into',
  'about', 'over', 'after', 'before', 'because', 'during', 'without', 'within', 'there', 'their',
  'they', 'them', 'were', 'when', 'will', 'would', 'could', 'should', 'does', 'doing', 'been', 'being',
  'also', 'very', 'much', 'than', 'then', 'into', 'onto', 'onto', 'due', 'while', 'where', 'which',
  'however', 'makes', 'make', 'made', 'take', 'takes', 'taken', 'per', 'day', 'week', 'hour', 'minute',
  'session', 'sessions', 'visit', 'visits', 'plan', 'follow', 'up', 'followup', 'reported', 'reports',
  'history', 'chief', 'complaint', 'assessment', 'plan', 'note', 'denies', 'states', 'reports'
]);

/**
 * Normalize medical terms using medical-entities synonym mappings.
 * Maps synonyms to canonical forms (e.g., "dyspnea" → "shortness of breath") for better search.
 * @param {string} text - Raw text
 * @returns {string} Text with synonyms normalized to canonical terms
 */
function normalizeMedicalTerms(text) {
  if (!text || typeof text !== 'string') return text;
  const entities = loadMedicalEntities();
  const symptoms = entities.symptoms || {};
  const synonymToCanonical = new Map();
  for (const [key, def] of Object.entries(symptoms)) {
    const canonical = key.replace(/_/g, ' ');
    if (def && Array.isArray(def.synonyms)) {
      for (const syn of def.synonyms) {
        if (syn && typeof syn === 'string') {
          synonymToCanonical.set(syn.toLowerCase(), canonical);
        }
      }
    }
    synonymToCanonical.set(key.replace(/_/g, ' ').toLowerCase(), canonical);
  }
  if (synonymToCanonical.size === 0) return text;
  let normalized = text;
  const entries = Array.from(synonymToCanonical.entries())
    .filter(([syn, canonical]) => syn !== canonical.toLowerCase())
    .sort((a, b) => b[0].length - a[0].length); // longer phrases first to avoid partial overwrites
  for (const [syn, canonical] of entries) {
    if (canonical.length < syn.length && syn.includes(canonical)) continue; // avoid "low back pain" → "back pain"
    const regex = new RegExp(`\\b${syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    normalized = normalized.replace(regex, canonical);
  }
  return normalized;
}

/**
 * Expand medical abbreviations (SOB, HA, CP, DM, etc.) to full terms for better search.
 * @param {string} text - Raw text
 * @returns {string} Text with abbreviations expanded
 */
function expandMedicalAbbreviations(text) {
  if (!text || typeof text !== 'string') return text;
  if (Object.keys(medicalAbbreviations).length === 0) return text;
  let expanded = text;
  for (const [abbrev, full] of Object.entries(medicalAbbreviations)) {
    if (!abbrev || !full) continue;
    const regex = new RegExp(`\\b${abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    expanded = expanded.replace(regex, full);
  }
  return expanded;
}

function tokenize(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function extractKeywords(note, limit = 12) {
  if (!note || typeof note !== 'string') return [];
  const tokens = tokenize(note);
  const freq = new Map();

  for (const token of tokens) {
    if (token.length < 4) continue;
    if (DEFAULT_STOPWORDS.has(token)) continue;
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

/** Medical phrases that map well to ICD-10/CPT. Found phrases are searched first with higher weight. */
const MEDICAL_PHRASES = [
  'type 2 diabetes', 'type 1 diabetes', 'diabetes mellitus',
  'high blood pressure', 'hypertension', 'essential hypertension',
  'annual physical', 'wellness exam', 'preventive exam', 'well child', 'well child exam',
  'general examination', 'routine child', 'medical examination',
  'upper respiratory infection', 'acute sinusitis', 'common cold',
  'low back pain', 'lumbar strain', 'chronic low back pain',
  'urinary tract infection', 'uti',
  'osteoarthritis', 'knee osteoarthritis', 'hip osteoarthritis',
  'anxiety disorder', 'generalized anxiety', 'major depressive disorder', 'depression',
  'asthma', 'chronic obstructive pulmonary disease', 'copd',
  'gerd', 'gastroesophageal reflux',
  'migraine', 'migraine headache',
  'office visit', 'established patient', 'new patient', 'evaluation and management',
  'moderate complexity', 'low complexity', 'high complexity'
];

/** When a phrase is found, also search these related queries (e.g. "well child" doesn't match DB but "routine child health" does). */
const PHRASE_EXPANSIONS = {
  'well child': ['routine child health', 'child health examination'],
  'annual physical': ['general examination', 'adult medical examination'],
  'wellness check': ['general examination'],
  'preventive exam': ['general examination'],
  'type 2 diabetes': ['E11'],
  'diabetic neuropathy': ['E11']
};

function extractMedicalPhrases(note) {
  if (!note || typeof note !== 'string') return [];
  const lower = note.toLowerCase();
  const found = new Set();
  for (const phrase of MEDICAL_PHRASES) {
    if (lower.includes(phrase)) found.add(phrase);
  }
  for (const phrase of found) {
    for (const extra of PHRASE_EXPANSIONS[phrase] || []) {
      found.add(extra);
    }
  }
  return Array.from(found);
}

/** Cached CPT search (24h TTL). Wraps db.searchCptCodes. */
function searchCptCodesCached(query, limit = 15) {
  const q = (query || '').toString().trim();
  const cached = cache.get('code_lookup', 'cpt', q, limit);
  if (cached) return cached;
  const result = (typeof db.searchCptCodes === 'function' ? db.searchCptCodes(query, limit) : null) || [];
  cache.set('code_lookup', result, 'cpt', q, limit);
  return result;
}

function getCandidateCptCodes(note, options = {}) {
  const limit = options.limit || 12;
  const keywords = extractKeywords(note, 20);
  const results = new Map();

  if (keywords.length === 0) {
    return searchCptCodesCached('', limit);
  }

  for (const keyword of keywords) {
    const matches = searchCptCodesCached(keyword, 5);
    for (const item of matches) {
      if (!results.has(item.code)) {
        results.set(item.code, {
          code: item.code,
          description: item.description,
          category: item.category,
          subcategory: item.subcategory,
          matchedKeywords: new Set([keyword])
        });
      } else {
        results.get(item.code).matchedKeywords.add(keyword);
      }
    }
  }

  const sorted = Array.from(results.values())
    .sort((a, b) => b.matchedKeywords.size - a.matchedKeywords.size)
    .slice(0, limit);
  const maxMatches = sorted[0]?.matchedKeywords?.size || 1;

  return sorted.map((item, index) => {
    // Confidence: rank-based (top=higher) + match strength (more keywords = higher)
    const rankFactor = 1 - (index * 0.08); // 1.0, 0.92, 0.84, ...
    const matchStrength = Math.min(1, (item.matchedKeywords.size / maxMatches) + 0.2);
    const confidence = Math.round(Math.min(1, Math.max(0.5, rankFactor * matchStrength)) * 100) / 100;

    return {
      code: item.code,
      description: item.description,
      category: item.category,
      subcategory: item.subcategory,
      matched_keywords: Array.from(item.matchedKeywords),
      confidence
    };
  });
}

/**
 * Retrieve ICD-10 candidates from search query (same pattern as getCandidateCptCodes).
 * Uses extractKeywords + searchIcd10Codes per term.
 * @param {string} note - Clinical note or search query
 * @param {Object} options - { limit }
 * @returns {Array<{code, description, category, matched_keywords, confidence}>}
 */
function getCandidateIcd10Codes(note, options = {}) {
  const limit = options.limit || 12;
  const keywords = extractKeywords(note, 20);
  const results = new Map();

  if (keywords.length === 0) {
    return (searchIcd10Codes('', limit) || []).map(r => ({ ...r, matched_keywords: [], confidence: 0.6 }));
  }

  for (const keyword of keywords) {
    const matches = searchIcd10Codes(keyword, 5) || [];
    for (const item of matches) {
      if (!results.has(item.code)) {
        results.set(item.code, {
          code: item.code,
          description: item.description || '',
          category: item.category || '',
          matchedKeywords: new Set([keyword])
        });
      } else {
        results.get(item.code).matchedKeywords.add(keyword);
      }
    }
  }

  const sorted = Array.from(results.values())
    .sort((a, b) => b.matchedKeywords.size - a.matchedKeywords.size)
    .slice(0, limit);
  const maxMatches = sorted[0]?.matchedKeywords?.size || 1;

  return sorted.map((item, index) => {
    const rankFactor = 1 - (index * 0.08);
    const matchStrength = Math.min(1, (item.matchedKeywords.size / maxMatches) + 0.2);
    const confidence = Math.round(Math.min(1, Math.max(0.5, rankFactor * matchStrength)) * 100) / 100;
    return {
      code: item.code,
      description: item.description,
      category: item.category,
      matched_keywords: Array.from(item.matchedKeywords),
      confidence
    };
  });
}

/**
 * Retrieve CPT + ICD-10 candidates using perceptual-state-based query when available.
 * When perceptualState is present, builds query from visual/textual findings instead of raw note.
 * @param {string} clinicalNote - Raw clinical note (fallback when no perceptual state)
 * @param {Object} options - { perceptualState, limitCpt, limitIcd10, clinicId, callId }
 * @returns {{ cpt, icd10, searchIntent? }}
 */
function getCandidatesForCoding(clinicalNote, options = {}) {
  const limitCpt = options.limitCpt ?? 10;
  const limitIcd10 = options.limitIcd10 ?? 12;
  const perceptualState = options.perceptualState;

  const searchIntent = perceptualState ? buildSearchIntent(perceptualState, clinicalNote) : null;
  const query = searchIntent ? searchIntent.query : (clinicalNote || '').toString().trim();

  const cpt = getCandidateCptCodes(query, { limit: limitCpt });
  const icd10 = getCandidateIcd10Codes(query, { limit: limitIcd10 });

  const result = { cpt, icd10 };
  if (searchIntent) result.searchIntent = searchIntent;
  return result;
}

/**
 * Compute confidence for a code (0-1). Used when normalizing coding outputs.
 * @param {Object} code - Code object
 * @param {number} defaultConfidence - Default if not present (default: 0.8)
 * @returns {number} Confidence score
 */
function ensureCodeConfidence(code, defaultConfidence = 0.8) {
  if (code && typeof code.confidence === 'number') {
    return Math.min(1, Math.max(0, code.confidence));
  }
  return defaultConfidence;
}

function getReferenceIcdCodes(limit = 15, defaultConfidence = 0.8) {
  if (!Array.isArray(icdCache) || icdCache.length === 0) {
    return [];
  }
  return icdCache.slice(0, limit).map(item => {
    const base = typeof item === 'object' ? { ...item } : { code: item, description: '' };
    base.confidence = typeof base.confidence === 'number' ? base.confidence : defaultConfidence;
    return base;
  });
}

/**
 * Search ICD-10 codes by query (code or description).
 * Uses DB (icd10_codes) when populated, else falls back to JSON reference.
 * Results cached 24h for frequent queries (Phase 3.3).
 * @param {string} query - Search term (code prefix or description keywords)
 * @param {number} limit - Max results (default 15)
 * @returns {Array} Matched codes with code, description, category
 */
function searchIcd10Codes(query, limit = 15) {
  const raw = (query || '').toString().trim();
  const q = expandMedicalAbbreviations(raw).trim() || raw;
  if (!q) return getReferenceIcdCodes(limit).map(c => ({ code: c.code, description: c.description || '', category: c.category || '' }));

  const cached = cache.get('code_lookup', 'icd10', q, limit);
  if (cached) return cached;

  let result;
  // Prefer DB when icd10_codes table is populated
  if (typeof db.getIcd10CodesCount === 'function') {
    const count = db.getIcd10CodesCount();
    if (count > 0 && typeof db.searchIcd10Codes === 'function') {
      result = db.searchIcd10Codes(query, limit);
    }
  }

  if (!result) {
    // Fallback: JSON reference
    if (!Array.isArray(icdCache) || icdCache.length === 0) {
      result = [];
    } else {
      const qLower = q.toLowerCase();
      const scored = [];
      for (const item of icdCache) {
        const code = (item.code || '').toString();
        const desc = (item.description || '').toString().toLowerCase();
        const cat = (item.category || '').toString().toLowerCase();
        let score = 0;
        if (code.toLowerCase().startsWith(qLower)) score += 10;
        if (code.toLowerCase().includes(qLower)) score += 5;
        if (desc.includes(qLower)) score += 3;
        if (cat.includes(qLower)) score += 1;
        if (score > 0) scored.push({ ...item, _score: score });
      }
      result = scored
        .sort((a, b) => b._score - a._score)
        .slice(0, limit)
        .map(({ code, description, category, _score }) => ({ code, description: description || '', category: category || '' }));
    }
  }

  cache.set('code_lookup', result, 'icd10', q, limit);
  return result;
}

function matchSimpleRule({ appointmentType, durationMinutes, clinicalNote }) {
  if (!Array.isArray(simpleRules) || simpleRules.length === 0) return null;
  const noteLower = (clinicalNote || '').toLowerCase();
  for (const rule of simpleRules) {
    const match = rule.match || {};
    if (match.appointment_type && appointmentType !== match.appointment_type) continue;
    if (match.duration_minutes && Number(durationMinutes) !== Number(match.duration_minutes)) continue;

    let diagnosisOk = true;
    if (Array.isArray(match.diagnosis_keywords) && match.diagnosis_keywords.length > 0) {
      diagnosisOk = match.diagnosis_keywords.some(keyword => noteLower.includes(keyword.toLowerCase()));
    }

    let procedureOk = true;
    if (Array.isArray(match.procedure_keywords) && match.procedure_keywords.length > 0) {
      procedureOk = match.procedure_keywords.some(keyword => noteLower.includes(keyword.toLowerCase()));
    }

    if (diagnosisOk && procedureOk) {
      return {
        id: rule.id,
        icd10: rule.icd10 || [],
        cpt: rule.cpt || [],
        rationale: rule.rationale || ''
      };
    }
  }
  return null;
}

/**
 * Search HCPCS codes (procedures, supplies, DME, modifiers).
 * Uses DB when hcpcs_codes table is populated. Results cached 24h (Phase 3.3).
 * @param {string} query - Search term
 * @param {number} limit - Max results (default 15)
 * @returns {Array} Matched codes with code, long_desc, short_desc, type
 */
function searchHcpcsCodes(query, limit = 15) {
  const q = (query || '').toString().trim();
  if (!q) return [];

  const cached = cache.get('code_lookup', 'hcpcs', q, limit);
  if (cached) return cached;

  let result = [];
  if (typeof db.getHcpcsCodesCount === 'function' && typeof db.searchHcpcsCodes === 'function') {
    const count = db.getHcpcsCodesCount();
    if (count > 0) {
      result = db.searchHcpcsCodes(query, limit).map(r => ({
        code: r.code,
        description: r.long_desc || r.short_desc || '',
        short_desc: r.short_desc,
        type: r.type,
        pricing_ind: r.pricing_ind,
        coverage_cd: r.coverage_cd
      }));
    }
  }
  cache.set('code_lookup', result, 'hcpcs', q, limit);
  return result;
}

/**
 * RAG Pipeline: Retrieve ICD-10, CPT, HCPCS candidates for a clinical note.
 * Uses keyword extraction + search. Optionally merges with semantic results.
 * When perceptualState is provided, builds query from findings (Layer 2).
 * @param {string} clinicalNote - Clinical note or query text
 * @param {Object} options - { maxIcd10, maxCpt, maxHcpcs, useSemantic, perceptualState, clinicId, callId }
 * @returns {Promise<Object>} { icd10, cpt, hcpcs }
 */
function getCodeCandidates(clinicalNote, options = {}) {
  return _getCodeCandidatesImpl(clinicalNote, options);
}

const PHRASE_MATCH_BOOST = 2;
const ICD10_PER_TERM = 25;
const CPT_PER_TERM = 10;

async function _getCodeCandidatesImpl(clinicalNote, options = {}) {
  const maxIcd10 = options.maxIcd10 ?? 20;
  const maxCpt = options.maxCpt ?? 15;
  const maxHcpcs = options.maxHcpcs ?? 10;

  // Section 11: default useSemantic to true when embeddings exist and feature enabled
  let useSemantic = options.useSemantic;
  if (useSemantic === undefined) {
    const embedCount = typeof db.getCodeEmbeddingsCount === 'function' ? db.getCodeEmbeddingsCount() : 0;
    const featureFlags = require('../utils/feature-flags');
    useSemantic = embedCount > 0 && featureFlags.isEnabled('semantic_search_enabled', options.clinicId, options.callId);
  }

  const rawNote = (clinicalNote || '').toString().trim();
  const perceptualState = options.perceptualState;
  const searchIntent = perceptualState ? buildSearchIntent(perceptualState, rawNote) : null;
  const queryBase = searchIntent && searchIntent.source === 'perceptual' ? searchIntent.query : rawNote;
  const note = normalizeMedicalTerms(expandMedicalAbbreviations(queryBase));
  const phrases = extractMedicalPhrases(note);
  const keywords = extractKeywords(note, 15);
  const specialty = searchIntent?.specialty || null;

  const icd10Results = new Map();
  const cptResults = new Map();
  const hcpcsResults = new Map();

  function addIcd10(r, weight = 1) {
    if (!icd10Results.has(r.code)) {
      icd10Results.set(r.code, { ...r, _matchCount: weight });
    } else {
      icd10Results.get(r.code)._matchCount += weight;
    }
  }
  function addCpt(r, weight = 1) {
    if (!cptResults.has(r.code)) {
      cptResults.set(r.code, { ...r, _matchCount: weight });
    } else {
      cptResults.get(r.code)._matchCount += weight;
    }
  }
  function addHcpcs(r, weight = 1) {
    if (!hcpcsResults.has(r.code)) {
      hcpcsResults.set(r.code, { ...r, _matchCount: weight });
    } else {
      hcpcsResults.get(r.code)._matchCount += weight;
    }
  }

  for (const phrase of phrases) {
    (searchIcd10Codes(phrase, ICD10_PER_TERM) || []).forEach(r => addIcd10(r, PHRASE_MATCH_BOOST));
    (searchCptCodesCached(phrase, CPT_PER_TERM) || []).forEach(r => addCpt(r, PHRASE_MATCH_BOOST));
    (searchHcpcsCodes(phrase, 8) || []).forEach(r => addHcpcs(r, PHRASE_MATCH_BOOST));
  }

  for (const kw of keywords) {
    (searchIcd10Codes(kw, ICD10_PER_TERM) || []).forEach(r => addIcd10(r));
    (searchCptCodesCached(kw, CPT_PER_TERM) || []).forEach(r => addCpt(r));
    (searchHcpcsCodes(kw, 5) || []).forEach(r => addHcpcs(r));
  }

  if (note && (icd10Results.size === 0 || cptResults.size === 0)) {
    (searchIcd10Codes(note, maxIcd10) || []).forEach(r => {
      if (!icd10Results.has(r.code)) icd10Results.set(r.code, { ...r, _matchCount: 0.5 });
    });
    (searchCptCodesCached(note, maxCpt) || []).forEach(r => {
      if (!cptResults.has(r.code)) cptResults.set(r.code, { ...r, _matchCount: 0.5 });
    });
    (searchHcpcsCodes(note, maxHcpcs) || []).forEach(r => {
      if (!hcpcsResults.has(r.code)) hcpcsResults.set(r.code, { ...r, _matchCount: 0.5 });
    });
  }

  const sortByMatch = (a, b) => (b._matchCount || 0) - (a._matchCount || 0);

  const icd10 = Array.from(icd10Results.values())
    .sort(sortByMatch)
    .slice(0, maxIcd10)
    .map(({ _matchCount, ...r }) => ({ ...r, confidence: Math.min(1, 0.5 + (_matchCount || 0) * 0.1) }));

  const cpt = Array.from(cptResults.values())
    .sort(sortByMatch)
    .slice(0, maxCpt)
    .map(({ _matchCount, ...r }) => ({ ...r, confidence: Math.min(1, 0.5 + (_matchCount || 0) * 0.1) }));

  const hcpcs = Array.from(hcpcsResults.values())
    .sort(sortByMatch)
    .slice(0, maxHcpcs)
    .map(({ _matchCount, ...r }) => ({ ...r, confidence: Math.min(1, 0.5 + (_matchCount || 0) * 0.1) }));

  if (useSemantic) {
    try {
      const semanticService = require('./semantic-search-service');
      const hybrid = await semanticService.hybridSearch(note, {
        limit: Math.max(maxIcd10, maxCpt, maxHcpcs),
        codeTypes: ['icd10', 'cpt', 'hcpcs'],
        specialty: specialty || undefined
      });
      hybrid.forEach(r => {
        if (r.code_type === 'icd10' && icd10.length < maxIcd10 && !icd10.some(c => c.code === r.code)) {
          icd10.push({ code: r.code, description: r.description || '', confidence: r.score || 0.7 });
        } else if (r.code_type === 'cpt' && cpt.length < maxCpt && !cpt.some(c => c.code === r.code)) {
          cpt.push({ code: r.code, description: r.description || '', confidence: r.score || 0.7 });
        } else if (r.code_type === 'hcpcs' && hcpcs.length < maxHcpcs && !hcpcs.some(c => c.code === r.code)) {
          hcpcs.push({ code: r.code, description: r.description || '', confidence: r.score || 0.7 });
        }
      });
    } catch (e) {
      console.warn('⚠️  Semantic merge skipped:', e.message);
    }
  }

  return { icd10, cpt, hcpcs };
}

/**
 * Validate that all codes exist in knowledge base (Phase 6.1).
 * Prevents hallucinated codes from being suggested.
 * @param {Object} codes - { icd10: string[], cpt: string[], hcpcs?: string[] }
 * @returns {{ valid: boolean, invalid: { icd10: string[], cpt: string[], hcpcs: string[] } }}
 */
function validateCodesExist(codes = {}) {
  const invalid = { icd10: [], cpt: [], hcpcs: [] };
  (codes.icd10 || []).forEach(c => {
    if (c && !db.codeExists?.(c, 'icd10')) invalid.icd10.push(String(c));
  });
  (codes.cpt || []).forEach(c => {
    if (c && !db.codeExists?.(c, 'cpt')) invalid.cpt.push(String(c));
  });
  (codes.hcpcs || []).forEach(c => {
    if (c && !db.codeExists?.(c, 'hcpcs')) invalid.hcpcs.push(String(c));
  });
  const hasInvalid = invalid.icd10.length > 0 || invalid.cpt.length > 0 || invalid.hcpcs.length > 0;
  return { valid: !hasInvalid, invalid };
}

/**
 * Validate ICD-10 + CPT code pair compatibility (Phase 6.2).
 * @param {string} icd10 - ICD-10 code
 * @param {string} cpt - CPT code
 * @returns {{ valid: boolean, reason?: string }}
 */
/**
 * Rule-based confidence (Tiba spec: φ^rule_i).
 * Returns 1.0 if rule match or validateCodePair passes; 0 if pair invalid.
 * @param {string} icd10 - ICD-10 code
 * @param {string} cpt - CPT code
 * @param {boolean} fromSimpleRule - True if code came from matchSimpleRule
 * @returns {number} Confidence 0..1
 */
function computeRuleConfidence(icd10, cpt, fromSimpleRule = false) {
  if (fromSimpleRule) return 1.0;
  if (!icd10 || !cpt) return 1.0;
  const v = validateCodePair(icd10, cpt);
  return v.valid ? 1.0 : 0;
}

function validateCodePair(icd10, cpt) {
  if (!icd10 || !cpt) return { valid: true };

  const rules = loadCodePairRules();

  const icd = String(icd10).trim().toUpperCase().replace(/\./g, '');
  const cptStr = String(cpt).trim();

  for (const r of rules.incompatible_pairs || []) {
    const icdRe = r.icd10_pattern ? new RegExp(r.icd10_pattern) : null;
    const cptRe = r.cpt_pattern ? new RegExp(r.cpt_pattern) : null;
    if (icdRe && icdRe.test(icd) && cptRe && cptRe.test(cptStr)) {
      return { valid: false, reason: r.reason || 'Incompatible code pair' };
    }
  }
  return { valid: true };
}

const PRIOR_AUTH_RULES_PATH = path.resolve(__dirname, '../../Knowledge/rules/prior-auth-rules.json');
let priorAuthRules = null;

function loadPriorAuthRules() {
  if (priorAuthRules !== null) return priorAuthRules;
  priorAuthRules = { requires_prior_auth: [], phi_auth_cap: 0.6 };
  try {
    if (fs.existsSync(PRIOR_AUTH_RULES_PATH)) {
      priorAuthRules = JSON.parse(fs.readFileSync(PRIOR_AUTH_RULES_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('⚠️  Prior-auth rules load failed:', e.message);
  }
  return priorAuthRules;
}

/**
 * Check if CPT code requires prior authorization (Tiba spec 2.4).
 * @param {string} cptCode - CPT code
 * @returns {boolean}
 */
function requiresPriorAuth(cptCode) {
  const rules = loadPriorAuthRules();
  const codes = rules.requires_prior_auth || [];
  const c = String(cptCode || '').trim();
  return codes.includes(c);
}

/**
 * Get φ_auth_cap for prior-auth penalty (Tiba spec 2.4).
 * @returns {number}
 */
function getPhiAuthCap() {
  const rules = loadPriorAuthRules();
  return typeof rules.phi_auth_cap === 'number' ? rules.phi_auth_cap : 0.6;
}

const MODIFIER_RULES_PATH = path.resolve(__dirname, '../../Knowledge/rules/modifier-rules.json');
let modifierRules = null;

function loadModifierRules() {
  if (modifierRules !== null) return modifierRules;
  modifierRules = { em_codes: [], combinations: [], phi_modifier_cap: 0.6 };
  try {
    if (fs.existsSync(MODIFIER_RULES_PATH)) {
      modifierRules = JSON.parse(fs.readFileSync(MODIFIER_RULES_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('⚠️  Modifier rules load failed:', e.message);
  }
  return modifierRules;
}

const EM_SET = new Set(['99202', '99203', '99204', '99205', '99211', '99212', '99213', '99214', '99215']);

function isEmCode(code) {
  return EM_SET.has(String(code || '').trim());
}

function isProcedureCode(code) {
  const c = String(code || '').trim();
  return /^[12]\d{4}$/.test(c) || /^[69]\d{4}$/.test(c);
}

/**
 * Get required modifiers per CPT (Tiba spec 2.5).
 * Returns Map: cptCode -> [required modifiers]
 * @param {Array} cptList - [{ code, modifiers?: [] }] or string[]
 */
function getRequiredModifiers(cptList) {
  const rules = loadModifierRules();
  const emCodes = rules.em_codes && rules.em_codes.length ? new Set(rules.em_codes) : EM_SET;
  const required = new Map();
  const codes = (cptList || []).map(c => (typeof c === 'object' ? (c.code || c) : c).toString().trim()).filter(Boolean);
  if (codes.length <= 1) return required;

  const emCodesInList = codes.filter(c => emCodes.has(c) || isEmCode(c));
  const procedureCodesInList = codes.filter(c => isProcedureCode(c) && !emCodes.has(c) && !isEmCode(c));

  if (emCodesInList.length > 0 && procedureCodesInList.length > 0) {
    for (const em of emCodesInList) {
      const existing = required.get(em) || [];
      if (!existing.includes('-25')) existing.push('-25');
      required.set(em, existing);
    }
  }

  if (procedureCodesInList.length > 1 || (emCodesInList.length > 0 && procedureCodesInList.length >= 1)) {
    const secondaries = procedureCodesInList.slice(1);
    for (const sec of secondaries) {
      const existing = required.get(sec) || [];
      if (!existing.includes('-59')) existing.push('-59');
      required.set(sec, existing);
    }
  }

  return required;
}

/**
 * Validate modifiers present on codes.
 * @returns {{ valid: boolean, missing: Array<{ code, missingModifiers: [] }> }}
 */
function validateModifiers(cptList) {
  const required = getRequiredModifiers(cptList);
  const missing = [];
  for (const c of cptList) {
    const code = (typeof c === 'object' ? (c.code || c) : c).toString().trim();
    const mods = (typeof c === 'object' && Array.isArray(c.modifiers) ? c.modifiers : []).map(m => String(m).trim());
    const need = required.get(code) || [];
    const missingForCode = need.filter(m => !mods.includes(m));
    if (missingForCode.length > 0) {
      missing.push({ code, missingModifiers: missingForCode });
    }
  }
  return { valid: missing.length === 0, missing };
}

/**
 * φ^modifier_i: 0.60 if required modifier missing, else 1.0
 */
function computeModifierConfidence(cptList) {
  const v = validateModifiers(cptList);
  const rules = loadModifierRules();
  const cap = rules.phi_modifier_cap ?? 0.6;
  return v.valid ? 1.0 : cap;
}

// NecessityRules versioning (Tiba spec 5.4)
const CODE_PAIR_PATH = path.resolve(__dirname, '../../Knowledge/rules/code-pair-validation.json');

function loadCodePairRules() {
  let rules = cache.get('coding_rules', 'code_pair_validation');
  if (!rules) {
    rules = { incompatible_pairs: [] };
    try {
      if (fs.existsSync(CODE_PAIR_PATH)) {
        rules = JSON.parse(fs.readFileSync(CODE_PAIR_PATH, 'utf8'));
        cache.set('coding_rules', rules, 'code_pair_validation');
      }
    } catch (e) {
      console.warn('⚠️  Code-pair validation rules load failed:', e.message);
    }
  }
  return rules;
}

/**
 * Get rule version effective for a given date.
 * @param {string|Date} date - ISO date string or Date
 * @returns {string} version or 'unknown'
 */
function getRuleVersionForDate(date) {
  const rules = loadCodePairRules();
  return rules.version || 'unknown';
}

/**
 * SHA256 hash of rules JSON for audit.
 * @returns {string}
 */
function getRuleHash() {
  try {
    if (!fs.existsSync(CODE_PAIR_PATH)) return '';
    const raw = fs.readFileSync(CODE_PAIR_PATH, 'utf8');
    return crypto.createHash('sha256').update(raw).digest('hex');
  } catch (e) {
    return '';
  }
}

// Time-based CPT rules (Tiba spec 2.6)
const TIME_BASED_CPT_PATH = path.resolve(__dirname, '../../Knowledge/rules/time-based-cpt-rules.json');
let timeBasedCptRules = null;

function loadTimeBasedCptRules() {
  if (timeBasedCptRules !== null) return timeBasedCptRules;
  timeBasedCptRules = { min_duration_minutes: {}, phi_time_cap: 0.6 };
  try {
    if (fs.existsSync(TIME_BASED_CPT_PATH)) {
      timeBasedCptRules = JSON.parse(fs.readFileSync(TIME_BASED_CPT_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('⚠️  Time-based CPT rules load failed:', e.message);
  }
  return timeBasedCptRules;
}

/**
 * Validate CPT duration meets minimum for time-based billing.
 * @param {string} cptCode - CPT code
 * @param {number} durationMinutes - Encounter duration in minutes
 * @returns {{ valid: boolean, required?: number }}
 */
function validateCptDuration(cptCode, durationMinutes) {
  const rules = loadTimeBasedCptRules();
  const mins = rules.min_duration_minutes || {};
  const required = mins[String(cptCode || '').trim()];
  if (required == null) return { valid: true };
  const duration = typeof durationMinutes === 'number' ? durationMinutes : 0;
  return { valid: duration >= required, required };
}

/**
 * φ^time_i: phi_time_cap (0.6) if duration below required, else 1.0
 */
function computeTimeConfidence(cptList, durationMinutes) {
  if (durationMinutes == null || durationMinutes < 0) return 1.0;
  const rules = loadTimeBasedCptRules();
  const cap = rules.phi_time_cap ?? 0.6;
  for (const c of cptList || []) {
    const code = (typeof c === 'object' ? (c.code || c) : c).toString().trim();
    const v = validateCptDuration(code, durationMinutes);
    if (!v.valid) return cap;
  }
  return 1.0;
}

function getPhiTimeCap() {
  const rules = loadTimeBasedCptRules();
  return rules.phi_time_cap ?? 0.6;
}

module.exports = {
  getCandidateCptCodes,
  getCandidateIcd10Codes,
  getCandidatesForCoding,
  getReferenceIcdCodes,
  searchIcd10Codes,
  searchHcpcsCodes,
  getCodeCandidates,
  validateCodesExist,
  validateCodePair,
  computeRuleConfidence,
  extractKeywords,
  expandMedicalAbbreviations,
  normalizeMedicalTerms,
  matchSimpleRule,
  ensureCodeConfidence,
  requiresPriorAuth,
  getPhiAuthCap,
  loadModifierRules,
  getRequiredModifiers,
  validateModifiers,
  computeModifierConfidence,
  loadTriageRules,
  loadMedicalEntities,
  loadExtractionPatterns,
  getRuleVersionForDate,
  getRuleHash,
  loadTimeBasedCptRules,
  validateCptDuration,
  computeTimeConfidence,
  getPhiTimeCap
};
