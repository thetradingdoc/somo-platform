/**
 * Text Encoder - Layer 1 Perception
 *
 * Maps clinical text to perceptual schema (textual_findings).
 * Uses medical-text-extraction-service + medical-abbreviations for abbreviation expansion.
 */

const medicalTextExtraction = require('../clinical/medical-text-extraction-service');
const path = require('path');
const fs = require('fs');

const MEDICAL_ABBREVIATIONS = (() => {
  try {
    return require(path.resolve(__dirname, '../../../Knowledge/ontology/medical-abbreviations.json'));
  } catch (_) {
    return {};
  }
})();

function expandAbbreviations(text) {
  if (!text || typeof text !== 'string') return text;
  let expanded = text;
  const abbrs = Object.keys(MEDICAL_ABBREVIATIONS).sort((a, b) => b.length - a.length);
  abbrs.forEach((abbr) => {
    const full = MEDICAL_ABBREVIATIONS[abbr];
    const regex = new RegExp(`\\b${abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    expanded = expanded.replace(regex, full);
  });
  return expanded;
}

const MEDICAL_ENTITIES_PATH = path.resolve(__dirname, '../../../Knowledge/ontology/medical-entities.json');
let medicalEntities = {};

try {
  if (fs.existsSync(MEDICAL_ENTITIES_PATH)) {
    medicalEntities = JSON.parse(fs.readFileSync(MEDICAL_ENTITIES_PATH, 'utf8'));
  }
} catch (e) {
  // ignore
}

/**
 * Extract temporal context (onset, duration, frequency) from text near a finding
 */
function extractTemporalContext(text, span) {
  if (!text || !span || !Array.isArray(span)) return null;
  const start = Math.max(0, span[0] - 80);
  const end = Math.min(text.length, span[1] + 80);
  const window = text.slice(start, end).toLowerCase();

  let onset = null;
  if (/sudden|acute|rapid|immediate/.test(window)) onset = 'acute';
  else if (/gradual|slow|progressive/.test(window)) onset = 'gradual';
  else if (/chronic|long-standing|ongoing/.test(window)) onset = 'chronic';

  const durationMatch = window.match(/(\d+)\s+(day|week|month|year|hour)s?/i);
  const duration = durationMatch ? `${durationMatch[1]} ${durationMatch[2]}s` : null;

  let frequency = null;
  if (/constant|continuous|persistent/.test(window)) frequency = 'constant';
  else if (/intermittent|occasional|episodic/.test(window)) frequency = 'intermittent';

  if (!onset && !duration && !frequency) return null;
  return { onset, duration, frequency };
}

/**
 * Extract laterality (left/right/bilateral) from text near a match
 */
function extractLaterality(text, start, end) {
  const window = text.slice(
    Math.max(0, start - 30),
    Math.min(text.length, end + 30)
  ).toLowerCase();
  if (/\bleft\b/.test(window)) return 'left';
  if (/\bright\b/.test(window)) return 'right';
  if (/\bbilateral\b/.test(window)) return 'bilateral';
  return null;
}

/**
 * Convert medical-text-extraction output to perceptual textual_findings schema
 * @param {string} text - Clinical text
 * @returns {object} { findings, original_text, expanded_text }
 */
function extractTextualFindings(text) {
  if (!text || typeof text !== 'string') {
    return { findings: [], original_text: text || '', expanded_text: '' };
  }

  const expandedText = expandAbbreviations(text);

  const structured = medicalTextExtraction.extractStructuredData(expandedText);
  const findings = [];

  // Symptoms (use expanded text for span/temporal/laterality since extraction uses expanded)
  for (const s of structured.symptoms || []) {
    const concept = String(s).toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
    const idx = expandedText.toLowerCase().indexOf(String(s).toLowerCase());
    const span = idx >= 0 ? [idx, idx + String(s).length] : null;
    const temporal = extractTemporalContext(expandedText, span);
    const laterality = span ? extractLaterality(expandedText, span[0], span[1]) : null;
    findings.push({
      type: 'symptom',
      concept: concept || 'symptom',
      mention: s,
      confidence: 0.9,
      span,
      severity: structured.severity?.severity || null,
      temporal: temporal || structured.severity?.temporal || null,
      laterality
    });
  }

  // Vitals
  const vitals = structured.vitals || {};
  if (Object.keys(vitals).length > 0) {
    const v = vitals;
    if (v.temperature != null) {
      findings.push({ type: 'vitals', concept: 'temperature', value: v.temperature, unit: 'F', confidence: 0.95 });
    }
    if (v.heart_rate != null) {
      findings.push({ type: 'vitals', concept: 'heart_rate', value: v.heart_rate, unit: 'bpm', confidence: 0.95 });
    }
    if (v.systolic != null && v.diastolic != null) {
      findings.push({
        type: 'vitals',
        concept: 'blood_pressure',
        value: `${v.systolic}/${v.diastolic}`,
        unit: 'mmHg',
        confidence: 0.95
      });
    }
  }

  // Temporal (duration, onset)
  const temporal = structured.temporal || {};
  if (Object.keys(temporal).length > 0) {
    findings.push({
      type: 'temporal',
      concept: 'duration_or_onset',
      mention: JSON.stringify(temporal),
      confidence: 0.85,
      temporal
    });
  }

  return {
    findings,
    original_text: text,
    expanded_text: expandedText
  };
}

/**
 * Extract negative findings (exclusion keywords) from clinical text.
 * Used for perceptual-state-aware negative constraints in Layer 2 RAG.
 * Patterns: "no X", "denies X", "negative for X", "closed fracture", "rule out X", etc.
 *
 * @param {string} text - Clinical text
 * @returns {{ exclusion_keywords: string[], negative_findings: Array<{ phrase: string, exclusions: string[] }> }}
 */
function extractNegativeFindings(text) {
  if (!text || typeof text !== 'string') {
    return { exclusion_keywords: [], negative_findings: [] };
  }

  const exclusion_keywords = new Set();
  const negative_findings = [];
  const t = text.slice(0, 8000);

  const patterns = [
    { re: /\bno\s+(open|closed|acute|chronic)\s+([a-z\s]+)/gi, idx: 1, expand: { open: ['open'], closed: ['open'], acute: ['acute'], chronic: ['chronic'] } },
    { re: /\bdenies\s+([a-z\s]+)/gi, idx: 1, expand: {} },
    { re: /\bwithout\s+([a-z\s]+)/gi, idx: 1, expand: {} },
    { re: /\bruled?\s+out\s+([a-z\s]+)/gi, idx: 1, expand: {} },
    { re: /\bnegative\s+for\s+([a-z\s]+)/gi, idx: 1, expand: {} },
    { re: /\bno\s+([a-z]+)\s+(wound|fracture|dislocation|bleeding|infection)/gi, idx: 2, expand: { wound: ['open', 'laceration', 'puncture'], fracture: ['open'], infection: ['infection', 'infected', 'sepsis'] } }
  ];

  for (const { re, idx, expand } of patterns) {
    let m;
    const regex = new RegExp(re.source, re.flags);
    while ((m = regex.exec(t)) !== null) {
      const matched = (m[idx] || m[1] || '').toLowerCase().trim();
      const words = matched.split(/\s+/).filter(w => w.length > 2);
      const exclusions = [...words];
      const firstWord = words[0];
      if (expand[firstWord]) {
        expand[firstWord].forEach(e => {
          exclusions.push(e);
          exclusion_keywords.add(e);
        });
      }
      words.forEach(w => exclusion_keywords.add(w));
      negative_findings.push({ phrase: m[0].trim(), exclusions });
    }
  }

  if (/\bclosed\s+fracture\b/i.test(t)) {
    exclusion_keywords.add('open');
    negative_findings.push({ phrase: 'closed fracture', exclusions: ['open'] });
  }
  if (/\bno\s+open\b/i.test(t)) {
    exclusion_keywords.add('open');
    negative_findings.push({ phrase: 'no open', exclusions: ['open'] });
  }
  if (/\bdenies\s+chest\s+pain\b/i.test(t)) {
    exclusion_keywords.add('angina');
    negative_findings.push({ phrase: 'denies chest pain', exclusions: ['angina'] });
  }
  if (/\bno\s+infection\b/i.test(t)) {
    exclusion_keywords.add('infection');
    negative_findings.push({ phrase: 'no infection', exclusions: ['infection'] });
  }

  return {
    exclusion_keywords: Array.from(exclusion_keywords).filter(term => term.length > 2),
    negative_findings
  };
}

module.exports = {
  extractTextualFindings,
  extractNegativeFindings
};
