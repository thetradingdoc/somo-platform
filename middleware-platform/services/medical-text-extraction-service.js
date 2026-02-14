/**
 * Medical Text Extraction Service
 *
 * Extracts structured data (symptoms, vitals, severity, temporal) from patient utterances.
 * Uses extraction-patterns.json, medical-entities.json, severity-indicators.json.
 */

const fs = require('fs');
const path = require('path');

const EXTRACTION_PATTERNS_PATH = path.resolve(__dirname, '../../Knowledge/ontology/extraction-patterns.json');
const SEVERITY_INDICATORS_PATH = path.resolve(__dirname, '../../Knowledge/ontology/severity-indicators.json');
const MEDICAL_ENTITIES_PATH = path.resolve(__dirname, '../../Knowledge/ontology/medical-entities.json');

let extractionPatterns = { symptoms: [], vitals: [], temporal: [], severity: [] };
let severityIndicators = {};
let medicalEntities = {};

try {
  if (fs.existsSync(EXTRACTION_PATTERNS_PATH)) {
    extractionPatterns = JSON.parse(fs.readFileSync(EXTRACTION_PATTERNS_PATH, 'utf8'));
  }
} catch (e) {
  console.warn('⚠️  medical-text-extraction: extraction-patterns load failed:', e.message);
}

try {
  if (fs.existsSync(SEVERITY_INDICATORS_PATH)) {
    severityIndicators = JSON.parse(fs.readFileSync(SEVERITY_INDICATORS_PATH, 'utf8'));
  }
} catch (e) {
  console.warn('⚠️  medical-text-extraction: severity-indicators load failed:', e.message);
}

try {
  if (fs.existsSync(MEDICAL_ENTITIES_PATH)) {
    medicalEntities = JSON.parse(fs.readFileSync(MEDICAL_ENTITIES_PATH, 'utf8'));
  }
} catch (e) {
  console.warn('⚠️  medical-text-extraction: medical-entities load failed:', e.message);
}

function expandAbbreviations(text) {
  try {
    const knowledgeService = require('./knowledge-service');
    return knowledgeService.expandMedicalAbbreviations(text || '');
  } catch (_) {
    return text || '';
  }
}

function extractSymptoms(text) {
  const t = expandAbbreviations(text || '').toLowerCase();
  const found = new Set();

  for (const p of extractionPatterns.symptoms || []) {
    try {
      const re = new RegExp(p.pattern, 'gi');
      const m = t.match(re);
      if (m) m.forEach(x => found.add(x.trim()));
    } catch (_) {
      if (t.includes((p.pattern || '').toLowerCase())) found.add(p.pattern);
    }
  }

  const entities = medicalEntities.symptoms || {};
  for (const [key, def] of Object.entries(entities)) {
    const synonyms = def.synonyms || [key.replace(/_/g, ' ')];
    for (const s of synonyms) {
      if (t.includes(s.toLowerCase())) found.add(s);
    }
  }

  return Array.from(found);
}

function extractVitalSigns(text) {
  const t = text || '';
  const result = {};

  for (const p of extractionPatterns.vitals || []) {
    try {
      const re = new RegExp(p.pattern, 'i');
      const m = t.match(re);
      if (m) {
        if (p.extract === 'temperature') result.temperature = parseFloat(m[1] || m[2]) || null;
        else if (p.extract === 'heart_rate') result.heart_rate = parseInt(m[1] || m[2], 10) || null;
        else if (Array.isArray(p.extract) && p.extract.length >= 2) {
          result.systolic = parseInt(m[1], 10) || null;
          result.diastolic = parseInt(m[2], 10) || null;
        }
      }
    } catch (_) {}
  }

  return result;
}

function detectSeverity(text) {
  const t = (text || '').toLowerCase();
  const painScale = severityIndicators.pain_scale || {};
  const temporal = severityIndicators.temporal || {};

  let severity = null;
  for (const [level, words] of Object.entries(painScale)) {
    if (words.some(w => t.includes(w.toLowerCase()))) {
      severity = level;
      break;
    }
  }

  let temporalInfo = null;
  for (const [level, words] of Object.entries(temporal)) {
    if (words.some(w => t.includes(w.toLowerCase()))) {
      temporalInfo = level;
      break;
    }
  }

  return { severity, temporal: temporalInfo };
}

function extractTemporalInfo(text) {
  const t = (text || '').toLowerCase();
  const result = {};

  for (const p of extractionPatterns.temporal || []) {
    try {
      const re = new RegExp(p.pattern, 'i');
      const m = t.match(re);
      if (m && p.extract) {
        const key = typeof p.extract === 'string' ? p.extract : (p.extract[0] || 'value');
        result[key] = m[1] || m[0];
      }
    } catch (_) {}
  }

  return result;
}

function extractStructuredData(text) {
  const expanded = expandAbbreviations(text || '');
  return {
    symptoms: extractSymptoms(expanded),
    vitals: extractVitalSigns(expanded),
    severity: detectSeverity(expanded),
    temporal: extractTemporalInfo(expanded)
  };
}

module.exports = {
  extractStructuredData,
  extractSymptoms,
  extractVitalSigns,
  detectSeverity,
  extractTemporalInfo
};
