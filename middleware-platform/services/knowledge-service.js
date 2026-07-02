const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../database');
const cache = require('./cache-service');
const { buildSearchQuery, buildSearchIntent } = require('./layer2-rag/search-intent-builder');
const {
  retrieveRemoteCodeKnowledge,
  resolveRagApiUrl
} = require('./layer2-rag/remote-rag-client');
const { pineconeFallbackEnabled } = require('./layer2-rag/pinecone-code-metadata-client');
const { extractNegativeConstraints, filterCodesByNegativeConstraints } = require('./layer2-rag/negative-constraints');
const { filterIcd10ByGuidelines } = require('./layer2-rag/guideline-resolver');
const { rerankByPerceptualRelevance } = require('./layer2-rag/reranking-service');

const ICD_REFERENCE_PATH = path.resolve(__dirname, '../../Knowledge/ICD-10 Files/icd10_reference.json');
const ICD_REFERENCE_PATH_FALLBACK = path.resolve(__dirname, '../../Knowledge/icd10_reference.json');
const SIMPLE_RULES_PATH = path.resolve(__dirname, '../../Knowledge/rules/simple-coding-rules.json');
const MEDICAL_ABBREVIATIONS_PATH = path.resolve(__dirname, '../../Knowledge/ontology/medical-abbreviations.json');
const MEDICAL_ENTITIES_PATH = path.resolve(__dirname, '../../Knowledge/ontology/medical-entities.json');
const EXTRACTION_PATTERNS_PATH = path.resolve(__dirname, '../../Knowledge/ontology/extraction-patterns.json');
const KNOWLEDGE_EXPORT_PATH = path.resolve(__dirname, '../../Knowledge/RAG/knowledge_export.json');
const ICD10_CORRECTIONS_PATH = path.resolve(__dirname, '../../Knowledge/RAG/icd10_term_corrections.json');
const CONCEPT_CORRECTIONS_PATH = path.resolve(__dirname, '../../Knowledge/RAG/concept_icd10_corrections.json');
const LAY_LANGUAGE_EXPANSIONS_PATH = path.resolve(__dirname, '../../Knowledge/rules/lay-language-icd-expansions.json');

// Colab export state (populated by loadColabExports)
let _colabLoaded = false;
let _colabMeta = {};
let _conceptMap = {};
let _icd10Expansions = {};
let _termToCodes = {};
let _phraseExpansions = {};
let _medicalPhrasesFromExport = [];
let _cptFamilyMap = {};

function loadConceptIcdCorrections() {
  if (!fs.existsSync(CONCEPT_CORRECTIONS_PATH)) return;
  try {
    const conceptCorr = JSON.parse(fs.readFileSync(CONCEPT_CORRECTIONS_PATH, 'utf8'));
    let conceptApplied = 0;
    for (const [cid, fix] of Object.entries(conceptCorr)) {
      if (cid.startsWith('_') || !fix?.icd10_codes?.length) continue;
      if (_conceptMap[cid]) {
        _conceptMap[cid].icd10_codes = fix.icd10_codes;
        conceptApplied++;
      }
    }
    if (conceptApplied > 0) {
      console.log(`[knowledge-service] Applied ${conceptApplied} concept ICD-10 corrections`);
    }
  } catch (e) {
    console.warn('[knowledge-service] concept corrections load failed:', e.message);
  }
}

function mergeIcd10TermCorrectionsIntoExportMap() {
  if (!fs.existsSync(ICD10_CORRECTIONS_PATH)) return;
  try {
    const corrections = JSON.parse(fs.readFileSync(ICD10_CORRECTIONS_PATH, 'utf8'));
    let applied = 0;
    for (const [term, icd10] of Object.entries(corrections)) {
      if (term.startsWith('_')) continue;
      if (!Array.isArray(icd10) || icd10.length === 0) continue;
      const key = term.toLowerCase().trim();
      if (!_termToCodes[key]) _termToCodes[key] = { icd10: [], cpt: [] };
      if (!_termToCodes[key].icd10 || _termToCodes[key].icd10.length === 0) {
        _termToCodes[key].icd10 = icd10;
        applied++;
      }
    }
    if (applied > 0) {
      console.log(`[knowledge-service] Merged ${applied} ICD-10 term corrections into term map`);
    }
  } catch (e) {
    console.warn('[knowledge-service] icd10_term_corrections merge failed:', e.message);
  }
}

function loadLayLanguageExpansions() {
  if (!fs.existsSync(LAY_LANGUAGE_EXPANSIONS_PATH)) return;
  try {
    const data = JSON.parse(fs.readFileSync(LAY_LANGUAGE_EXPANSIONS_PATH, 'utf8'));
    const extraPhrases = Array.isArray(data.phrases) ? data.phrases : [];
    for (const p of extraPhrases) {
      if (p && !MEDICAL_PHRASES.includes(p)) MEDICAL_PHRASES.push(p);
    }
    const expansions = data.phrase_expansions || {};
    for (const [phrase, targets] of Object.entries(expansions)) {
      if (phrase.startsWith('_')) continue;
      const existing = PHRASE_EXPANSIONS[phrase] || [];
      PHRASE_EXPANSIONS[phrase] = [...new Set([...existing, ...(Array.isArray(targets) ? targets : [])])];
    }
    console.log(
      `[knowledge-service] Lay-language expansions loaded (${extraPhrases.length} phrases, ${Object.keys(expansions).length} maps)`
    );
  } catch (e) {
    console.warn('[knowledge-service] lay-language-icd-expansions load failed:', e.message);
  }
}

function loadColabExports() {
  if (_colabLoaded) return;
  mergeIcd10TermCorrectionsIntoExportMap();
  if (!fs.existsSync(KNOWLEDGE_EXPORT_PATH)) {
    _colabLoaded = true;
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(KNOWLEDGE_EXPORT_PATH, 'utf8'));
    _conceptMap = data.concept_specialty_map || {};
    _icd10Expansions = data.icd10_code_expansions || {};
    _termToCodes = { ..._termToCodes, ...(data.term_to_codes || {}) };
    _phraseExpansions = { ..._phraseExpansions, ...(data.phrase_expansions || {}) };
    _medicalPhrasesFromExport = Array.isArray(data.medical_phrases) ? data.medical_phrases : [];
    _cptFamilyMap = data.cpt_family_map || {};
    _colabMeta = data._meta || {};
    loadConceptIcdCorrections();
    _colabLoaded = true;
    const m = data._meta || {};
    console.log(
      '[knowledge-service] Colab export loaded ✅\n' +
      '  Generated : ' + (m.generated_at || 'unknown') + '\n' +
      '  Concepts  : ' + Object.keys(_conceptMap).length + '\n' +
      '  ICD expan.: ' + Object.keys(_icd10Expansions).length + ' parents\n' +
      '  Terms     : ' + Object.keys(_termToCodes).length + '\n' +
      '  Phrases   : ' + _medicalPhrasesFromExport.length + '\n' +
      '  Phrase exp: ' + Object.keys(_phraseExpansions).length
    );
  } catch (err) {
    console.error('[knowledge-service] Failed to load Colab export: ' + err.message);
  }
}

let icdCache = [];
let simpleRules = [];
let medicalAbbreviations = {};
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

// orch-16: Single load – use triage-service as source of truth
function loadTriageRules() {
  const { getTriageRules } = require('./triage-service');
  return getTriageRules();
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
  'anxiety', 'anxiety disorder', 'generalized anxiety', 'major depressive disorder', 'depression',
  'psychotherapy', 'psychotherapy session',
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
  'diabetic neuropathy': ['E11'],
  'hypertension': ['I10', 'essential (primary) hypertension'],
  'high blood pressure': ['I10'],
  'essential hypertension': ['I10'],
  'anxiety': ['F41', 'anxiety disorder', 'generalized anxiety'],
  'anxiety disorder': ['F41', 'generalized anxiety'],
  'psychotherapy': ['90834', '45 minutes', 'F41', 'anxiety disorder'],
  // MPFS CPT descriptions use CMS abbreviations (e.g. "Office o/p est low 20 min"), not lay terms.
  'office visit': ['office o/p'],
  'established patient': ['office o/p est', 'o/p est'],
  'new patient': ['office o/p new', 'o/p new'],
  'evaluation and management': ['office o/p'],
  'urinary tract infection': ['N39', 'cystitis', 'R30'],
  'annual wellness visit': ['Z00', 'G0438', 'G0439', 'general examination'],
  'wellness visit': ['Z00', 'G0438', 'preventive examination'],
  'prenatal visit': ['Z34', 'supervision of pregnancy'],
  'pregnant': ['Z34', 'O09'],
  'migraine headache': ['G43', 'G44']
};

function initPhraseKnowledge() {
  loadLayLanguageExpansions();
  loadColabExports();
}
initPhraseKnowledge();

/**
 * Filter codes to keep only those with at least one valid ICD-10/CPT pair.
 * @param {Array} codes - ICD-10 or CPT code objects
 * @param {Array} otherCodes - CPT or ICD-10 (the other type)
 * @param {'icd10'|'cpt'} type - 'icd10' if codes are ICD-10, 'cpt' if codes are CPT
 * @returns {Array}
 */
function filterCodesByValidPairs(codes, otherCodes, type) {
  if (!codes || codes.length === 0 || !otherCodes || otherCodes.length === 0) return codes;
  const other = otherCodes.map(c => (c?.code || c).toString().trim()).filter(Boolean);
  if (other.length === 0) return codes;
  return codes.filter(item => {
    const code = (item?.code || item).toString().trim();
    return other.some(oc => {
      const v = type === 'icd10' ? validateCodePair(code, oc) : validateCodePair(oc, code);
      return v.valid;
    });
  });
}

/**
 * Add prior-auth and modifier hints to CPT suggestions.
 * @param {Array} cptList - [{ code, ... }]
 * @param {Array} icd10List - For modifier rules (EM + procedure combos)
 * @returns {Array}
 */
function addCptMetadata(cptList, icd10List = []) {
  if (!cptList || !cptList.length) return cptList;
  const required = getRequiredModifiers(cptList);
  return cptList.map(c => {
    const code = (c?.code || c).toString().trim();
    const mods = required.get(code) || [];
    return {
      ...(typeof c === 'object' ? c : { code, description: '', confidence: 0.8 }),
      requires_prior_auth: requiresPriorAuth(code),
      suggested_modifiers: mods.length ? mods : undefined
    };
  });
}

/**
 * Apply confidence threshold and mark low-confidence codes for review.
 * @param {Array} list - Code objects
 * @param {Object} opts - { minConfidence, reviewRecommendedThreshold }
 * @returns {Array}
 */
function applyConfidenceRules(list, opts = {}) {
  const min = opts.minConfidence;
  const threshold = opts.reviewRecommendedThreshold ?? 0.7;
  if (!list || !list.length) return list;
  let out = list;
  if (typeof min === 'number' && min > 0) {
    out = out.filter(c => (c?.confidence ?? c?.score ?? 0) >= min);
  }
  return out.map(c => {
    const conf = c?.confidence ?? c?.score ?? 0.8;
    return { ...c, review_recommended: conf < threshold };
  });
}

/**
 * Enrich candidates using Colab export (term_to_codes, icd10_expansions, phrase_expansions).
 * @param {{ icd10: Array, cpt: Array, hcpcs?: Array }} candidates
 * @param {string} queryText
 * @param {Object} options - { minConfidence, reviewRecommendedThreshold }
 * @returns {{ icd10: Array, cpt: Array, hcpcs: Array }}
 */
function enrichCandidatesFromExport(candidates, queryText, options = {}) {
  if (!_colabLoaded) return candidates;
  const q = (queryText || '').toLowerCase();
  const icdSet = new Map();
  const cptSet = new Map();

  for (const item of (candidates.icd10 || [])) {
    const code = (item.code || item).toString().trim();
    const score = item.score ?? item.confidence ?? 0.8;
    icdSet.set(code, Math.max(score, icdSet.get(code) || 0));
    const parent = code.substring(0, 3).toUpperCase();
    const children = _icd10Expansions[parent] || [];
    for (const child of children) {
      if (!icdSet.has(child)) icdSet.set(child, Math.max(0.1, score - 0.05));
    }
  }
  for (const item of (candidates.cpt || [])) {
    const code = (item.code || item).toString().trim();
    const score = item.score ?? item.confidence ?? 0.8;
    cptSet.set(code, Math.max(score, cptSet.get(code) || 0));
  }

  const matchedTerms = [];
  let exportAddCount = 0;
  for (const term of Object.keys(_termToCodes)) {
    if (q.includes(term.toLowerCase())) {
      matchedTerms.push(term);
      const codes = _termToCodes[term];
      for (const icd of (codes.icd10 || [])) {
        if (!icdSet.has(icd)) { icdSet.set(icd, 0.82); exportAddCount++; }
      }
      for (const cpt of (codes.cpt || [])) {
        if (!cptSet.has(cpt)) { cptSet.set(cpt, 0.80); exportAddCount++; }
      }
    }
  }
  const hcpcsSet = new Map((candidates.hcpcs || []).map(h => [(h?.code || h).toString().trim(), h]));
  for (const matchedTerm of matchedTerms) {
    const synonyms = _phraseExpansions[matchedTerm.toLowerCase()] || [];
    for (const syn of synonyms) {
      const synCodes = _termToCodes[syn.toLowerCase()];
      if (!synCodes) continue;
      for (const icd of (synCodes.icd10 || [])) {
        if (!icdSet.has(icd)) { icdSet.set(icd, 0.75); exportAddCount++; }
      }
      for (const cpt of (synCodes.cpt || [])) {
        if (!cptSet.has(cpt)) { cptSet.set(cpt, 0.73); exportAddCount++; }
      }
      for (const hcpcs of (synCodes.hcpcs || [])) {
        if (!hcpcsSet.has(hcpcs)) { hcpcsSet.set(hcpcs, { code: hcpcs, confidence: 0.72, source: 'colab_export' }); exportAddCount++; }
      }
    }
  }
  for (const term of matchedTerms) {
    const codes = _termToCodes[term.toLowerCase()];
    for (const hcpcs of (codes?.hcpcs || [])) {
      if (!hcpcsSet.has(hcpcs)) { hcpcsSet.set(hcpcs, { code: hcpcs, confidence: 0.78, source: 'colab_export' }); exportAddCount++; }
    }
  }

  let finalIcd = Array.from(icdSet.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([code, score]) => {
      const orig = (candidates.icd10 || []).find(i => (i.code || i) === code);
      if (orig && typeof orig === 'object') return orig;
      return { code, description: code, confidence: score, source: 'colab_export' };
    });
  let finalCpt = Array.from(cptSet.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([code, score]) => {
      const orig = (candidates.cpt || []).find(c => (c.code || c) === code);
      if (orig && typeof orig === 'object') return orig;
      return { code, description: code, confidence: score, source: 'colab_export' };
    });

  finalIcd = filterCodesByValidPairs(finalIcd, finalCpt, 'icd10');
  finalCpt = filterCodesByValidPairs(finalCpt, finalIcd, 'cpt');

  const finalHcpcs = hcpcsSet.size > 0
    ? Array.from(hcpcsSet.values()).sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, 10)
    : (candidates.hcpcs || []);

  if (exportAddCount > 0 && process.env.NODE_ENV !== 'production') {
    console.log(`[knowledge-service] Colab export added ${exportAddCount} codes for query (${q.slice(0, 60)}...)`);
  }

  let icdOut = applyConfidenceRules(finalIcd.slice(0, 20), options);
  let cptOut = addCptMetadata(applyConfidenceRules(finalCpt.slice(0, 12), options), icdOut);
  return {
    icd10: icdOut,
    cpt: cptOut,
    hcpcs: applyConfidenceRules(finalHcpcs, options)
  };
}

function extractMedicalPhrases(note) {
  if (!note || typeof note !== 'string') return [];
  const allPhrases = new Set([...MEDICAL_PHRASES, ..._medicalPhrasesFromExport]);
  const lower = note.toLowerCase();
  const found = new Set();
  for (const phrase of allPhrases) {
    if (lower.includes(phrase.toLowerCase())) found.add(phrase);
  }
  for (const phrase of found) {
    for (const extra of (PHRASE_EXPANSIONS[phrase] || [])) found.add(extra);
    for (const syn of (_phraseExpansions[phrase.toLowerCase()] || [])) {
      if (lower.includes(syn.toLowerCase())) found.add(syn);
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
 * When RAG_API_URL is set, calls Colab RAG API for retrieval; otherwise uses local search.
 * @param {string} clinicalNote - Raw clinical note (fallback when no perceptual state)
 * @param {Object} options - { perceptualState, limitCpt, limitIcd10, clinicId, callId }
 * @returns {Promise<{ cpt, icd10, searchIntent? }>}
 */
async function getCandidatesForCoding(clinicalNote, options = {}) {
  const limitCpt = options.limitCpt ?? 10;
  const limitIcd10 = options.limitIcd10 ?? 12;
  const perceptualState = options.perceptualState;

  const searchIntent = perceptualState ? buildSearchIntent(perceptualState, clinicalNote) : null;
  const query = searchIntent ? searchIntent.query : (clinicalNote || '').toString().trim();
  const rawText = (clinicalNote || perceptualState?.expanded_text || '').toString();
  const rawConstraints = extractNegativeConstraints(rawText);
  const perceptualExclusions = searchIntent?.filters?.negative_constraints?.exclusion_keywords || [];
  const negativeConstraints = [...new Set([...rawConstraints, ...perceptualExclusions])];

  let cpt;
  let icd10;

  if (pineconeFallbackEnabled() || resolveRagApiUrl()) {
    const remoteResult = await retrieveRemoteCodeKnowledge({
      query: query || rawText.slice(0, 2000),
      specialty: searchIntent?.specialty || 'general',
      region: searchIntent?.region || 'US',
      exclusion_terms: negativeConstraints,
      top_k: Math.max(limitIcd10, limitCpt)
    });
    if (remoteResult && (remoteResult.icd10?.length > 0 || remoteResult.cpt?.length > 0)) {
      icd10 = (remoteResult.icd10 || []).slice(0, limitIcd10);
      cpt = (remoteResult.cpt || []).slice(0, limitCpt);
      console.log(`📚 Remote codes (${remoteResult.metadata?.source || 'remote'}): ${icd10.length} ICD-10, ${cpt.length} CPT`);
    }
  }

  // Fallback to local search when RAG unavailable or returned no results
  if (!cpt || !icd10) {
    cpt = getCandidateCptCodes(query, { limit: limitCpt });
    icd10 = getCandidateIcd10Codes(query, { limit: limitIcd10 });
  }

  if (negativeConstraints.length > 0) {
    cpt = filterCodesByNegativeConstraints(cpt, negativeConstraints);
    icd10 = filterCodesByNegativeConstraints(icd10, negativeConstraints);
  }

  const guidelineResult = filterIcd10ByGuidelines(icd10, []);
  icd10 = guidelineResult.filtered;

  if (perceptualState && (icd10.length > 0 || cpt.length > 0)) {
    icd10 = rerankByPerceptualRelevance(icd10, perceptualState, clinicalNote);
    cpt = rerankByPerceptualRelevance(cpt, perceptualState, clinicalNote);
  }

  let candidates = { icd10, cpt, hcpcs: [] };
  candidates = enrichCandidatesFromExport(candidates, query || rawText, options);
  const result = { cpt: candidates.cpt, icd10: candidates.icd10 };
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
async function getCodeCandidates(clinicalNote, options = {}) {
  const candidates = await _getCodeCandidatesImpl(clinicalNote, options);
  return enrichCandidatesFromExport(candidates, clinicalNote || '', options);
}

function _lookupCodeDescription(code, type) {
  if (!code) return '';
  const raw = String(code).trim();
  try {
    if (type === 'icd10') {
      const row = db.prepare(
        `SELECT description FROM icd10_codes WHERE UPPER(REPLACE(TRIM(code), '.', '')) = UPPER(REPLACE(?, '.', '')) LIMIT 1`
      ).get(raw);
      return row?.description || '';
    }
    if (type === 'cpt') {
      const row = db.prepare('SELECT description FROM cpt_codes WHERE UPPER(TRIM(code)) = UPPER(?) LIMIT 1').get(raw);
      return row?.description || '';
    }
    if (type === 'hcpcs') {
      const row = db.prepare('SELECT long_desc FROM hcpcs_codes WHERE UPPER(TRIM(code)) = UPPER(?) LIMIT 1').get(raw);
      return row?.long_desc || '';
    }
  } catch (_) { /* sqlite optional */ }
  return '';
}

/**
 * Boost / inject ICD candidates from term-level corrections when clinical text matches.
 * @param {{ icd10?: object[], cpt?: object[], hcpcs?: object[] }} candidates
 * @param {string} clinicalText
 */
function applyRemoteIcdCorrections(candidates, clinicalText) {
  const text = (clinicalText || '').toLowerCase();
  const icd10 = [...(candidates.icd10 || [])];
  if (!text || text.length < 3) return { ...candidates, icd10 };

  if (fs.existsSync(ICD10_CORRECTIONS_PATH)) {
    try {
      const corrections = JSON.parse(fs.readFileSync(ICD10_CORRECTIONS_PATH, 'utf8'));
      for (const [term, codes] of Object.entries(corrections)) {
        if (term.startsWith('_') || !Array.isArray(codes) || !codes.length) continue;
        if (!text.includes(term.toLowerCase())) continue;
        for (const code of codes) {
          const c = String(code).trim().toUpperCase();
          if (!c) continue;
          if (icd10.some((x) => String(x?.code || '').toUpperCase() === c)) continue;
          icd10.unshift({
            code: c,
            description: _lookupCodeDescription(c, 'icd10'),
            confidence: 0.92,
            source: 'term_correction'
          });
        }
      }
    } catch (e) {
      console.warn('[knowledge-service] applyRemoteIcdCorrections failed:', e.message);
    }
  }
  return { ...candidates, icd10 };
}

/** When Pinecone returns ICD only, infer outpatient E/M from visit context (not CPT_TABLE). */
function _inferEmCptForOutpatient(primaryIcd, opts = {}) {
  if (!primaryIcd) return null;
  const { CPT_INFERENCE_CONFIDENCE } = require('../config/coding-thresholds');
  const isNewPatient = opts.isNewPatient !== false;
  const urgency = String(opts.urgency || 'routine').toLowerCase();
  const tier = isNewPatient ? 'new' : 'established';
  const emMap = {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  };
  const urgKey = emMap[tier][urgency] ? urgency : 'routine';
  const code = emMap[tier][urgKey] || emMap[tier].routine;
  const v = validateCodesExist({ cpt: [code] });
  if (!v.valid) return null;
  return {
    code,
    description: _lookupCodeDescription(code, 'cpt'),
    confidence: CPT_INFERENCE_CONFIDENCE,
    source: 'em_inference'
  };
}

/**
 * Unified dual-source code retrieval: remote RAG + local search in parallel, merge, validate.
 * Use this for video consult, assistant overlay, or any API that needs consistent code suggestions.
 * Boundary shape: all code arrays use { code, description, confidence } only (no score at API boundary).
 * @param {string} clinicalText - Transcript or clinical note
 * @param {Object} options - { specialty, maxIcd10, maxCpt, maxHcpcs, useSemantic, perceptualState }
 * @returns {Promise<Object>} { icd10, cpt, hcpcs, invalid_codes?, remote_knowledge, local_knowledge, merged_codes }
 */
async function getCodeCandidatesDualSource(clinicalText, options = {}) {
  const text = (clinicalText || '').toString().trim().slice(0, 2000);
  const specialty = options.specialty || 'general';
  const maxIcd10 = options.maxIcd10 ?? 20;
  const maxCpt = options.maxCpt ?? 15;
  const maxHcpcs = options.maxHcpcs ?? 10;

  const remoteTimeoutMs = options.remoteTimeoutMs ?? parseInt(process.env.REMOTE_RAG_TIMEOUT_MS || '8000', 10);
  const [remoteSettled, localSettled] = await Promise.allSettled([
    retrieveRemoteCodeKnowledge(
      { query: text, specialty, top_k: Math.max(maxIcd10, maxCpt, maxHcpcs) },
      { timeoutMs: remoteTimeoutMs }
    ),
    _getCodeCandidatesImpl(text, { ...options, maxIcd10, maxCpt, maxHcpcs, useSemantic: options.useSemantic !== false })
  ]);

  let remote = remoteSettled.status === 'fulfilled' && remoteSettled.value
    ? remoteSettled.value
    : { icd10: [], cpt: [], hcpcs: [], metadata: { source: 'remote_error' } };
  remote = applyRemoteIcdCorrections(remote, text);
  const local = localSettled.status === 'fulfilled' && localSettled.value
    ? localSettled.value
    : { icd10: [], cpt: [], hcpcs: [], metadata: { source: 'local_error' } };

  let merged = _mergeRemoteAndLocalCodes(remote, local, { maxIcd10, maxCpt, maxHcpcs });

  const codeStrings = {
    icd10: (merged.icd10 || []).map((c) => c?.code).filter(Boolean),
    cpt: (merged.cpt || []).map((c) => c?.code).filter(Boolean),
    hcpcs: (merged.hcpcs || []).map((c) => c?.code).filter(Boolean)
  };
  const validation = validateCodesExist(codeStrings, { trustExternalSource: false });
  const validIcd10 = (merged.icd10 || []).filter((c) => c?.code && !validation.invalid.icd10.includes(String(c.code).trim()));
  const validCpt = (merged.cpt || []).filter((c) => c?.code && !validation.invalid.cpt.includes(String(c.code).trim()));
  const validHcpcs = (merged.hcpcs || []).filter((c) => c?.code && !validation.invalid.hcpcs.includes(String(c.code).trim()));

  const codes = {
    icd10: validIcd10.map((c) => ({
      code: c.code,
      description: c.description || _lookupCodeDescription(c.code, 'icd10'),
      confidence: ensureCodeConfidence(c)
    })),
    cpt: validCpt.map((c) => ({
      code: c.code,
      description: c.description || _lookupCodeDescription(c.code, 'cpt'),
      confidence: ensureCodeConfidence(c)
    })),
    hcpcs: validHcpcs.map((c) => ({
      code: c.code,
      description: c.description || _lookupCodeDescription(c.code, 'hcpcs'),
      confidence: ensureCodeConfidence(c)
    }))
  };
  const invalid_codes = (validation.invalid.icd10.length || validation.invalid.cpt.length || validation.invalid.hcpcs.length)
    ? validation.invalid
    : undefined;

  const confidence_breakdown = {
    local_icd_confidence: local.icd10?.[0]?.confidence ?? 0,
    remote_icd_confidence: remote.icd10?.[0]?.confidence ?? 0,
    remote_source: remote.metadata?.source || 'none',
    local_source: local.metadata?.source || 'local'
  };
  if (process.env.PHASE1_CODING_LOG === '1') {
    console.log('[knowledge-service] confidence_breakdown', confidence_breakdown);
  }

  if ((!codes.cpt || codes.cpt.length === 0) && codes.icd10?.length) {
    const inferred = _inferEmCptForOutpatient(codes.icd10[0]?.code, {
      isNewPatient: options.isNewPatient,
      urgency: options.urgency
    });
    if (inferred) {
      codes.cpt = [inferred];
      confidence_breakdown.cpt_inferred_from_icd = true;
    }
  }

  return {
    ...codes,
    invalid_codes,
    remote_knowledge: remote,
    local_knowledge: local,
    merged_codes: codes,
    confidence_breakdown
  };
}

/**
 * T1 Clinical Insight - quick lookup for drug/condition/trigger phrases.
 * Use for real-time HUD when patient mentions a specific term.
 * @param {string} trigger - Phrase or term (e.g. medication name, condition)
 * @param {Object} context - { transcriptSnippet?, specialty? }
 * @returns {Promise<{ codes, summary?, sources? }>}
 */
async function getClinicalInsight(trigger, context = {}) {
  const text = (trigger || '').toString().trim();
  if (!text || text.length < 3) return { codes: { icd10: [], cpt: [], hcpcs: [] } };
  const result = await getCodeCandidatesDualSource(text, {
    specialty: context.specialty || 'general',
    maxIcd10: 5,
    maxCpt: 3,
    maxHcpcs: 2
  });
  return {
    codes: {
      icd10: result.icd10 || [],
      cpt: result.cpt || [],
      hcpcs: result.hcpcs || []
    },
    sources: result.remote_knowledge?.metadata ? [{ source: 'RAG', doc_ref: result.remote_knowledge.metadata }] : []
  };
}

function _mergeRemoteAndLocalCodes(remote, local, limits = {}) {
  const maxIcd10 = limits.maxIcd10 ?? 20;
  const maxCpt = limits.maxCpt ?? 15;
  const maxHcpcs = limits.maxHcpcs ?? 10;
  const mk = () => new Map();
  const maps = { icd10: mk(), cpt: mk(), hcpcs: mk() };

  const add = (type, arr, source, boost = 0) => {
    (Array.isArray(arr) ? arr : []).forEach((c) => {
      if (!c || !c.code) return;
      const key = c.code;
      const conf = typeof c.confidence === 'number' ? c.confidence : (typeof c.score === 'number' ? c.score : 0.8);
      const score = conf + boost;
      const existing = maps[type].get(key);
      if (!existing || score > (existing._score || 0)) {
        maps[type].set(key, {
          code: c.code,
          description: c.description || '',
          confidence: conf,
          source: existing ? `${existing.source}+${source}` : source,
          _score: score
        });
      }
    });
  };

  add('icd10', remote.icd10, 'remote', 0);
  add('cpt', remote.cpt, 'remote', 0);
  add('hcpcs', remote.hcpcs, 'remote', 0);
  add('icd10', local.icd10, 'local', 0);
  add('cpt', local.cpt, 'local', 0);
  add('hcpcs', local.hcpcs, 'local', 0);

  const toSorted = (type, limit) =>
    Array.from(maps[type].values())
      .sort((a, b) => (b._score || 0) - (a._score || 0))
      .slice(0, limit)
      .map(({ _score, ...rest }) => rest);

  return {
    icd10: toSorted('icd10', maxIcd10),
    cpt: toSorted('cpt', maxCpt),
    hcpcs: toSorted('hcpcs', maxHcpcs)
  };
}

const PHRASE_MATCH_BOOST = 2;
const ICD10_PER_TERM = 25;
const CPT_PER_TERM = 10;

const EM_SET = new Set(['99202', '99203', '99204', '99205', '99211', '99212', '99213', '99214', '99215']);

function isEmCode(code) {
  return EM_SET.has(String(code || '').trim());
}

const TELEHEALTH_VISIT_CUES = /\b(telehealth|tele-health|telemedicine|video visit|virtual visit)\b/i;
const OUTPATIENT_VISIT_CUES = /\b(office visit|established patient|new patient|follow[- ]?up|e\/m|evaluation and management)\b/i;

/**
 * When query implies telehealth or office E/M, rank E/M CPT ahead of telehealth G-codes.
 */
function rankCptWithTelehealthContext(cptList, note) {
  if (!note || !Array.isArray(cptList) || !cptList.length) return cptList;
  const telehealth = TELEHEALTH_VISIT_CUES.test(note);
  const visit = OUTPATIENT_VISIT_CUES.test(note) || telehealth;
  if (!visit) return cptList;
  const em = cptList.filter((c) => isEmCode(c?.code));
  if (!em.length) return cptList;
  const gTele = cptList.filter((c) => {
    const code = String(c?.code || '').trim();
    return /^G\d/i.test(code) && !isEmCode(code);
  });
  const other = cptList.filter((c) => !em.includes(c) && !gTele.includes(c));
  return [...em, ...other, ...gTele];
}

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

  const hadEmCpt = Array.from(cptResults.values()).some((r) => isEmCode(r.code));
  let boostedDefaultEm = false;
  if (!hadEmCpt && icd10Results.size > 0) {
    boostedDefaultEm = true;
    (searchCptCodesCached('office o/p est', 6) || []).forEach((r) => addCpt(r, 3));
  }

  const sortByMatch = (a, b) => (b._matchCount || 0) - (a._matchCount || 0);

  let icd10 = Array.from(icd10Results.values())
    .sort(sortByMatch)
    .slice(0, maxIcd10)
    .map(({ _matchCount, ...r }) => ({ ...r, confidence: Math.min(1, 0.5 + (_matchCount || 0) * 0.1) }));

  let cpt = Array.from(cptResults.values())
    .sort(sortByMatch)
    .slice(0, maxCpt * 2)
    .map(({ _matchCount, ...r }) => ({ ...r, confidence: Math.min(1, 0.5 + (_matchCount || 0) * 0.1) }));
  if (boostedDefaultEm) {
    const em = cpt.filter((c) => isEmCode(c.code));
    const other = cpt.filter((c) => !isEmCode(c.code));
    cpt = [...em, ...other];
  }
  cpt = cpt.slice(0, maxCpt);

  let hcpcs = Array.from(hcpcsResults.values())
    .sort(sortByMatch)
    .slice(0, maxHcpcs)
    .map(({ _matchCount, ...r }) => ({ ...r, confidence: Math.min(1, 0.5 + (_matchCount || 0) * 0.1) }));

  if (useSemantic) {
    try {
      const semanticService = require('./semantic-search-service');
      const region = searchIntent?.region || 'US';
      const codeTypes = region === 'US' ? ['icd10', 'cpt', 'hcpcs'] : ['icd10'];
      const hybrid = await semanticService.hybridSearch(note, {
        limit: Math.max(maxIcd10, maxCpt, maxHcpcs),
        codeTypes,
        specialty: specialty || undefined,
        region
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

  cpt = rankCptWithTelehealthContext(cpt, note);

  const rawText = rawNote || (perceptualState?.expanded_text || '');
  const rawConstraints = extractNegativeConstraints(rawText);
  const perceptualExclusions = searchIntent?.filters?.negative_constraints?.exclusion_keywords || [];
  const negativeConstraints = [...new Set([...rawConstraints, ...perceptualExclusions])];
  if (negativeConstraints.length > 0) {
    icd10 = filterCodesByNegativeConstraints(icd10, negativeConstraints);
    cpt = filterCodesByNegativeConstraints(cpt, negativeConstraints);
    hcpcs = filterCodesByNegativeConstraints(hcpcs, negativeConstraints);
  }

  const guidelineResult = filterIcd10ByGuidelines(icd10, []);
  icd10 = guidelineResult.filtered;

  if (perceptualState && (icd10.length > 0 || cpt.length > 0)) {
    icd10 = rerankByPerceptualRelevance(icd10, perceptualState, rawNote);
    cpt = rerankByPerceptualRelevance(cpt, perceptualState, rawNote);
  }

  return { icd10, cpt, hcpcs };
}

/**
 * Validate that all codes exist in knowledge base (Phase 6.1).
 * Prevents hallucinated codes from being suggested.
 * When trustExternalSource (RAG) is enabled, accepts well-formatted codes even if not in local DB.
 * @param {Object} codes - { icd10: string[], cpt: string[], hcpcs?: string[] }
 * @param {Object} options - { trustExternalSource?: boolean, trustFormattedCodes?: boolean }
 *   When either is true, accept ICD-10/CPT/HCPCS that match canonical format without a local DB row
 *   (used for RAG-backed flows and for LLM coding output where the KB may be incomplete).
 * @returns {{ valid: boolean, invalid: { icd10: string[], cpt: string[], hcpcs: string[] } }}
 */
function validateCodesExist(codes = {}, options = {}) {
  const invalid = { icd10: [], cpt: [], hcpcs: [], icd10_pcs: [] };
  const trustByFormat =
    options.trustExternalSource === true ||
    options.trustFormattedCodes === true;

  const isIcd10Format = (s) => /^[A-Z]\d{2}(\.[A-Z0-9]{1,4})?$/.test(String(s).trim().toUpperCase());
  const isCptFormat = (s) => /^\d{5}$/.test(String(s).trim());
  const isDentalCdtFormat = (s) => /^D\d{4}$/i.test(String(s).trim());
  const isHcpcsFormat = (s) => /^[A-Z]\d{4}[A-Z0-9]?$/.test(String(s).trim().toUpperCase());

  (codes.icd10 || []).forEach(c => {
    if (!c) return;
    const str = String(c).trim();
    if (trustByFormat && isIcd10Format(str)) return;
    if (!db.codeExists?.(c, 'icd10')) invalid.icd10.push(str);
  });
  (codes.cpt || []).forEach(c => {
    if (!c) return;
    const str = String(c).trim();
    if (trustByFormat && (isCptFormat(str) || isDentalCdtFormat(str))) return;
    if (!db.codeExists?.(c, 'cpt')) invalid.cpt.push(str);
  });
  (codes.hcpcs || []).forEach(c => {
    if (!c) return;
    const str = String(c).trim();
    if (trustByFormat && isHcpcsFormat(str)) return;
    if (!db.codeExists?.(c, 'hcpcs')) invalid.hcpcs.push(str);
  });
  const isPcsFormat = (s) => /^[0-9A-HJ-NP-Z]{7}$/.test(String(s).trim().toUpperCase());
  (codes.icd10_pcs || []).forEach(c => {
    if (!c) return;
    const str = String(c).trim().toUpperCase();
    if (trustByFormat && isPcsFormat(str)) return;
    if (!db.codeExists?.(c, 'icd10_pcs')) invalid.icd10_pcs.push(str);
  });
  const hasInvalid = invalid.icd10.length > 0 || invalid.cpt.length > 0 || invalid.hcpcs.length > 0
    || invalid.icd10_pcs.length > 0;
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

/**
 * Expand ICD-10 codes using Colab export parent→children mappings.
 * @param {string[]} codes - ICD-10 codes from DB search
 * @returns {string[]} - Expanded list
 */
function expandIcd10WithExport(codes) {
  if (!_colabLoaded || !codes || !codes.length) return codes;
  const expanded = new Set(codes);
  for (const code of codes) {
    const parent = (code || '').substring(0, 3).toUpperCase();
    const children = _icd10Expansions[parent] || [];
    for (const child of children) expanded.add(child);
  }
  return Array.from(expanded);
}

/**
 * Lookup concept by ID for specialty and codes (Colab export).
 * @param {string} conceptId - e.g. 'C_HEP_CIRRHOSIS'
 * @returns {{ specialty, icd10_codes, cpt_codes, label } | null}
 */
function lookupConceptSpecialty(conceptId) {
  return _conceptMap[conceptId] || null;
}

/**
 * Summary of loaded Colab export for health checks.
 * @returns {Object}
 */
function getExportStats() {
  return {
    loaded: _colabLoaded,
    version: _colabMeta.version || 'unknown',
    generated_at: _colabMeta.generated_at || null,
    export_file: KNOWLEDGE_EXPORT_PATH,
    concepts: Object.keys(_conceptMap).length,
    icd10_parents: Object.keys(_icd10Expansions).length,
    icd10_children: Object.values(_icd10Expansions).reduce((s, v) => s + (v?.length || 0), 0),
    terms: Object.keys(_termToCodes).length,
    phrases: _medicalPhrasesFromExport.length,
    phrase_expansions: Object.keys(_phraseExpansions).length
  };
}

module.exports = {
  loadColabExports,
  enrichCandidatesFromExport,
  extractMedicalPhrases,
  expandIcd10WithExport,
  lookupConceptSpecialty,
  getExportStats,
  getCandidateCptCodes,
  getCandidateIcd10Codes,
  getCandidatesForCoding,
  getReferenceIcdCodes,
  searchIcd10Codes,
  searchHcpcsCodes,
  getCodeCandidates,
  getCodeCandidatesDualSource,
  getClinicalInsight,
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
