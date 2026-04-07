const db = require('../database');

function _on() {
  const v = String(process.env.CASE_DEIDENT_ENABLED || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function _redactText(text) {
  const s = String(text || '');
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted_email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted_phone]')
    .replace(/\b\d{1,5}\s+[A-Za-z0-9.\s]{3,40}\b/g, '[redacted_address]');
}

function _toFacetArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
  if (v == null) return [];
  return [String(v).trim()].filter(Boolean);
}

function ingestCasePattern(input = {}) {
  if (!_on()) return { success: false, skipped: true, reason: 'CASE_DEIDENT_DISABLED' };
  const summary = _redactText(input.summary || input.transcript || '');
  const complaint = String(input.chief_complaint || '').trim() || null;
  const specialty = String(input.specialty || '').trim() || null;
  const urgency = String(input.urgency || '').trim() || null;
  const safety = String(input.safety_level || '').trim() || null;
  const bodySites = _toFacetArray(input.body_sites);
  const riskFlags = _toFacetArray(input.risk_flags);
  const source = String(input.source || 'unknown');
  if (!summary && !complaint) return { success: false, error: 'insufficient_pattern_data' };
  return db.insertCasePattern({
    source,
    source_ref: input.source_ref || null,
    chief_complaint: complaint,
    specialty,
    urgency,
    safety_level: safety,
    body_sites: bodySites,
    risk_flags: riskFlags,
    summary_text: summary
  });
}

function searchCasePatterns({ complaint = '', specialty = '', urgency = '', safety_level = '', body_site = '', limit = 10 } = {}) {
  return db.searchCasePatterns({
    complaint,
    specialty,
    urgency,
    safety_level,
    body_site,
    limit
  });
}

module.exports = {
  isEnabled: _on,
  ingestCasePattern,
  searchCasePatterns
};
