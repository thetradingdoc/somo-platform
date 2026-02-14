/**
 * ClinicalBERT Service - Biomedical NER via transformers.js
 *
 * Uses onnx-community/biomedical-ner-all-ONNX (107 biomedical entity types) as the
 * backbone for clinical entity extraction. No rule-based fallback.
 *
 * Cost: Local inference only. Model ~66M params, ~100-500ms per chunk on CPU.
 * No API fees; compute is your server's CPU.
 */

const CLINICAL_BERT_MAX_TOKENS = 512;
const CLINICAL_NER_MODEL = process.env.CLINICAL_NER_MODEL || 'onnx-community/biomedical-ner-all-ONNX';

let pipelineInstance = null;

/**
 * Rough token estimate (4 chars ≈ 1 token for English)
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Sliding window chunk for 512-token limit. Overlap for boundary continuity.
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
 * Map biomedical NER entity type to our canonical type for fusion.
 * Preserves granularity where useful (symptom, disease, procedure, etc.)
 */
function mapEntityType(nerLabel) {
  if (!nerLabel || nerLabel === 'O') return null;
  const label = String(nerLabel).replace(/^[BI]-/, '').toLowerCase();
  const clinicalTypes = [
    'symptom', 'sign_symptom', 'disease', 'disorder', 'syndrome', 'procedure',
    'treatment', 'medication', 'drug', 'test', 'diagnosis', 'anatomy', 'finding'
  ];
  if (clinicalTypes.some(t => label.includes(t))) return label;
  return 'clinical_entity';
}

/** Common NER tokenization artifacts and their corrections. */
const MEDICAL_TERM_CORRECTIONS = {
  'electrocardiogram io gram': 'electrocardiogram',
  'electro card iogram': 'electrocardiogram',
  'electro card': 'electrocardiogram',
  'card iogram': 'cardiogram',
  'card ega': 'cardiac',
  'ofbreath': 'of breath',
  'tobear': 'to bear',
  'short ness': 'shortness',
  'ness of': 'ness of',
  'pal pit ations': 'palpitations',
  'pal pit': 'palpitation',
  'pit ations': 'palpitations',
  'aus cu': 'auscultation',
  'lta tion': 'auscultation',
  'x ray': 'x-ray'
};

/** Normalize hyphenated terms and apply medical term corrections. No aggressive merge. */
function normalizeEntityText(text) {
  if (!text) return text;
  let s = String(text).trim();
  // Fix hyphenated terms (e.g. "x - ray" -> "x-ray")
  s = s.replace(/\b([a-z0-9]+)\s+-\s+([a-z0-9]+)\b/gi, '$1-$2');
  // Apply known medical term corrections (order by length desc to match longer first)
  const entries = Object.entries(MEDICAL_TERM_CORRECTIONS).sort((a, b) => b[0].length - a[0].length);
  for (const [bad, good] of entries) {
    if (s.toLowerCase().includes(bad)) {
      s = s.replace(new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), good);
    }
  }
  return s.trim();
}

/** Stitch adjacent anatomical modifiers (distal + radius, proximal + femur, etc.) */
function stitchAdjacentEntities(entities) {
  const stitched = [];
  let i = 0;

  while (i < entities.length) {
    const current = entities[i];

    if (i < entities.length - 1) {
      const next = entities[i + 1];
      const anatomicalModifiers = ['distal', 'proximal', 'medial', 'lateral', 'anterior', 'posterior'];
      const currentIsModifier = anatomicalModifiers.includes((current.text || '').toLowerCase().trim());

      if (currentIsModifier && next.type === current.type && (next.confidence || 0) > 0.7) {
        stitched.push({
          ...current,
          text: `${(current.text || '').trim()} ${(next.text || '').trim()}`.trim(),
          confidence: Math.min(current.confidence || 0.5, next.confidence || 0.5)
        });
        i += 2;
        continue;
      }
    }

    stitched.push(current);
    i++;
  }
  return stitched;
}

/** Single-word fragments that look like NER split artifacts (e.g. "pal" from palpitations). */
const FRAGMENT_STOPWORDS = ['pal', 'pit', 'tions', 'ations', 'ness', 'ting', 'gram', 'ical', 'osis', 'itis'];

/** Demographics and non-clinical terms to exclude from entity list. */
const DEMOGRAPHIC_PATTERNS = [
  /\d+[- ]?year[- ]?old/i,
  /^\d+\s*-\s*year\s*-\s*old$/i,
  /\d+\s*year\s*old/i
];
const DEMOGRAPHIC_STOPWORDS = ['male', 'female', 'patient', 'individual', 'person'];

/** Filter garbage entities; reclassify temporal; exclude demographics. */
function isValidClinicalEntity(entity) {
  const text = (entity.text || '').toLowerCase().trim();

  const verbStopwords = ['follow', 'shows', 'reports', 'states', 'denies', 'after', 'before', 'during'];
  if (verbStopwords.includes(text)) return false;

  if (FRAGMENT_STOPWORDS.includes(text)) return false;
  if (text.length < 4 && !text.includes('-') && !/^\d+$/.test(text)) return false;

  if (DEMOGRAPHIC_STOPWORDS.includes(text)) return false;
  if (DEMOGRAPHIC_PATTERNS.some(p => p.test(text))) return false;

  const temporalPatterns = [
    /\d+\s*(month|week|day|year|hour)s?\s*(ago|after|before|since)/i,
    /since\s+(yesterday|monday|january)/i,
    /(last|next)\s+(week|month|year)/i
  ];
  if (temporalPatterns.some(p => p.test(text))) {
    entity.type = 'temporal_expression';
    return true;
  }

  return text.length >= 3;
}

/**
 * Load token-classification pipeline (lazy, singleton)
 */
async function loadPipeline() {
  if (pipelineInstance) return pipelineInstance;
  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = true;
    pipelineInstance = await pipeline('token-classification', CLINICAL_NER_MODEL);
    return pipelineInstance;
  } catch (e) {
    console.error('[clinical-bert] Failed to load biomedical NER model:', e.message);
    throw e;
  }
}

/**
 * Run biomedical NER on a single chunk. Returns entities.
 */
async function runNerChunk(classifier, chunk) {
  if (!chunk || !chunk.trim()) return [];
  const results = await classifier(chunk, { aggregation_strategy: 'simple' });
  return Array.isArray(results) ? results : [];
}

/**
 * Group consecutive B-I tokens into entities. Handles raw token-level output.
 */
function groupTokens(tokens) {
  const groups = [];
  let current = null;
  for (const t of tokens) {
    const label = String(t.entity || t.entity_group || t.label || 'O').trim();
    const word = String(t.word || t.entity || '').trim().replace(/^##/, '');
    if (!word) continue;
    const isB = label.startsWith('B-');
    const isI = label.startsWith('I-');
    const tag = label.replace(/^[BI]-/, '');
    if (isB) {
      current = { word, tag, score: t.score };
      groups.push(current);
    } else if (isI && current && tag === (current.tag || '')) {
      current.word += word.startsWith('##') ? word.replace(/^##/, '') : (' ' + word);
      current.score = typeof current.score === 'number' && typeof t.score === 'number'
        ? (current.score + t.score) / 2 : (current.score ?? t.score ?? 0.9);
    } else if (label !== 'O' && !isB && !isI) {
      groups.push({ word, tag: label, score: t.score });
      current = null;
    } else {
      current = null;
    }
  }
  return groups;
}

/**
 * Merge entities into final list with deduplication.
 * Handles both pre-aggregated (entity_group) and token-level (B-/I-) output.
 */
function mergeAndDedupe(allResults) {
  const raw = Array.isArray(allResults) ? allResults.flat() : [allResults];
  const hasTokenLevel = raw.some(r => {
    const l = String(r.entity || r.label || '');
    return l.startsWith('B-') || l.startsWith('I-');
  });
  const grouped = hasTokenLevel ? groupTokens(raw) : raw.map(r => ({
    word: r.word || r.entity_group || r.entity,
    tag: r.entity_group || r.entity || r.label,
    score: r.score
  }));
  const seen = new Set();
  const entities = [];
  for (const r of grouped) {
    const word = String(r.word || '').trim();
    const label = r.tag || r.entity || 'O';
    if (!word || label === 'O') continue;
    const key = `${word.toLowerCase()}:${mapEntityType(label) || 'unknown'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const type = mapEntityType(label) || 'clinical_entity';
    const score = typeof r.score === 'number' ? r.score : 0.9;
    const candidate = {
      type,
      text: normalizeEntityText(word),
      source: 'clinical_bert',
      confidence: Math.min(1, Math.max(0, score))
    };
    if (isValidClinicalEntity(candidate)) {
      entities.push(candidate);
    }
  }
  return stitchAdjacentEntities(entities);
}

/**
 * Extract clinical entities from normalized text using biomedical NER transformer.
 * This is the backbone of the perception pipeline; no rule-based fallback.
 */
async function extractClinicalEntities(normalizedText) {
  const text = (normalizedText || '').toString().trim();
  if (!text) return { entities: [], chunks: 0, ms: 0 };

  const t0 = Date.now();
  const classifier = await loadPipeline();
  const chunks = chunkForBert(text, CLINICAL_BERT_MAX_TOKENS);
  const allResults = [];

  for (const chunk of chunks) {
    const chunkResults = await runNerChunk(classifier, chunk);
    allResults.push(...chunkResults);
  }

  const entities = mergeAndDedupe(allResults);
  const ms = Date.now() - t0;

  return { entities, chunks: chunks.length, ms };
}

module.exports = {
  extractClinicalEntities,
  loadPipeline,
  chunkForBert,
  CLINICAL_BERT_MAX_TOKENS,
  CLINICAL_NER_MODEL
};
