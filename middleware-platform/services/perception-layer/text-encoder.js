/**
 * Text Encoder - Layer 1 Perception
 *
 * Maps clinical text to perceptual schema (textual_findings).
 * Uses medical-text-extraction-service + medical-abbreviations for abbreviation expansion.
 */

const medicalTextExtraction = require('../medical-text-extraction-service');
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

module.exports = {
  extractTextualFindings
};
