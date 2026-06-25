'use strict';

const fs = require('fs');
const path = require('path');

let specialtyMap = null;

function loadSpecialtyMap() {
  if (specialtyMap) return specialtyMap;
  const p = path.join(__dirname, '../../data/navigation/specialty-intent-map.json');
  specialtyMap = JSON.parse(fs.readFileSync(p, 'utf8'));
  return specialtyMap;
}

function extractZip(text) {
  const m = String(text || '').match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

function extractPlanHint(text) {
  const t = String(text || '').toLowerCase();
  if (/metro health plus|metro plus|\bmhp\b|metro health|metroplus/.test(t)) return 'Metro Health Plus';
  return null;
}

function extractCareNeed(text) {
  const t = String(text || '').toLowerCase();
  const map = loadSpecialtyMap();
  for (const entry of Object.values(map)) {
    for (const phrase of entry.phrases || []) {
      if (t.includes(String(phrase).toLowerCase())) {
        return {
          specialty: entry.specialty,
          label: entry.label || entry.specialty,
          matched_phrase: phrase
        };
      }
    }
  }
  return null;
}

function extractSpecialty(text) {
  const need = extractCareNeed(text);
  return need?.specialty || null;
}

function extractMemberId(text) {
  const m = String(text || '').match(/\b(?:member\s*(?:id|#)?\s*|id\s*)\s*([A-Za-z0-9-]{6,})\b/i);
  return m ? m[1] : null;
}

function extractEmployerCode(text) {
  const m = String(text || '').match(/\b(?:employer\s*code|company\s*code)\s*([A-Za-z0-9-]{3,})\b/i);
  return m ? m[1] : null;
}

function wantsBenefits(text) {
  return /what.?s covered|benefits|coverage|copay|deductible|what do i get/i.test(String(text || ''));
}

function wantsContactInfo(text) {
  return /yes|sure|phone|number|hours|contact|call them/i.test(String(text || ''));
}

module.exports = {
  extractZip,
  extractPlanHint,
  extractCareNeed,
  extractSpecialty,
  extractMemberId,
  extractEmployerCode,
  wantsBenefits,
  wantsContactInfo
};
