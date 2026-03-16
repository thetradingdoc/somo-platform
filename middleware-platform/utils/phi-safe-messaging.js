/**
 * Telemedicine Phase 1 — Task 11: PHI-safe messaging validation.
 * Use before sending SMS or email body to catch accidental PHI. Not a full PHI detector; apply human review to templates.
 */
const FORBIDDEN_PATTERNS = [
  /\b(diagnosis|diagnosed with|condition|ICD[- ]?10|CPT)\s*:?\s*[\w.-]+/i,
  /\b(lab result|test result|blood (sugar|count)|HbA1c|creatinine|glucose)\s*:?\s*[\d.]+\s*(mg|mmol|g\/dL)?/i,
  /\b(patient|pt\.?)\s+[\w']+\s+(has|with|suffers|diagnosed)/i,
  /\b(rx|medication|prescription)\s*:?\s*[\w\s]+\s+\d+\s*(mg|mcg|units?)/i,
  /\b(DOB|date of birth)\s*:?\s*\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/i,
  /\b(SSN|social security)\s*:?\s*[\d-]+/i
];

/**
 * Validate that a message body does not contain obvious PHI patterns.
 * @param {string} body - Plain text or HTML (will be stripped for check)
 * @returns {{ safe: boolean, violations: string[] }}
 */
function validatePhiSafeMessage(body) {
  if (!body || typeof body !== 'string') {
    return { safe: true, violations: [] };
  }
  const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const violations = [];
  for (const re of FORBIDDEN_PATTERNS) {
    if (re.test(text)) {
      violations.push(re.source || 'forbidden pattern');
    }
  }
  return {
    safe: violations.length === 0,
    violations
  };
}

module.exports = { validatePhiSafeMessage, FORBIDDEN_PATTERNS };
