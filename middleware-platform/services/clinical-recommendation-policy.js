'use strict';

/**
 * Guardrails for consumer-facing clinical assistant text (Kelly, chat, voice).
 * Does not replace clinician judgment; blocks egregious definitive-diagnosis patterns.
 */

const FORBIDDEN_REGEX = [
  { code: 'definitive_diagnosis', re: /\byou (definitely )?have\s+(?!an appointment|a reservation)\b/i },
  { code: 'certainty_cancer', re: /\bthis is (your |)(cancer|malignant|terminal)\b/i },
  { code: 'prescription_dosing', re: /\btake\s+\d+\s*(mg|mcg|g)\b.*\b(daily|twice|tid|qid)\b/i },
  { code: 'stop_medication', re: /\bstop taking (your |all |)(medication|medicine|pills)\s+now\b/i }
];

const FALLBACK_REPLY =
  'I can share general education and next steps, but I cannot give a definitive diagnosis or specific dosing. A clinician should confirm anything that affects your treatment. What symptom or concern should we focus on next?';

/** Used when the same guardrails fire during Skin & Care (no clinical triage phrasing). */
const FALLBACK_REPLY_ROUTINE_SKINCARE =
  'I have to stay in general education here—not a diagnosis or personal dosing. A clinician should confirm anything that affects your treatment. What would you like to know next about your routine or products?';

function validateAssistantText(text) {
  const s = String(text || '').trim();
  if (!s) return { ok: true };
  for (const { code, re } of FORBIDDEN_REGEX) {
    if (re.test(s)) return { ok: false, code, fallback: FALLBACK_REPLY };
  }
  return { ok: true };
}

function fallbackReply(validation, opts = {}) {
  if (opts.routineSkincare) return FALLBACK_REPLY_ROUTINE_SKINCARE;
  return validation?.fallback || FALLBACK_REPLY;
}

module.exports = {
  validateAssistantText,
  fallbackReply,
  FORBIDDEN_REGEX,
  FALLBACK_REPLY,
  FALLBACK_REPLY_ROUTINE_SKINCARE
};
