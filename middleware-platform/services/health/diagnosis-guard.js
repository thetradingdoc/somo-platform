'use strict';

/**
 * Education-tool safety net: block definitive diagnosis language in patient-facing replies.
 * Used by health-turn-service and acceptance scripts.
 */
const DIAGNOSIS_PATTERNS = [
  /\byou have\b/i,
  /\bit is\b/i,
  /\bthis is\b/i,
  /\bdiagnosis\b/i,
  /\byou are suffering from\b/i,
  /\bit looks like [a-z]+ (disease|condition|syndrome)\b/i,
  /\byou(?:'re| are) (?:likely )?(?:having|experiencing) [a-z]+ (?:disease|syndrome|disorder)\b/i,
  /\bI (?:can )?diagnose\b/i,
  /\bdefinitely (?:have|is)\b/i
];

const ABSTAIN_REPLY =
  'I do not have enough grounded information to say what this might be. ' +
  'What you described is worth discussing with a clinician for a professional opinion.';

function containsDiagnosisLanguage(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return DIAGNOSIS_PATTERNS.some((re) => re.test(t));
}

function findDiagnosisMatches(text) {
  const t = String(text || '');
  return DIAGNOSIS_PATTERNS.filter((re) => re.test(t)).map((re) => re.source);
}

function sanitizeDiagnosisLanguage(text, { abstainText = ABSTAIN_REPLY } = {}) {
  if (!containsDiagnosisLanguage(text)) return { text, blocked: false };
  return { text: abstainText, blocked: true };
}

module.exports = {
  DIAGNOSIS_PATTERNS,
  ABSTAIN_REPLY,
  containsDiagnosisLanguage,
  findDiagnosisMatches,
  sanitizeDiagnosisLanguage
};
