/**
 * PII Redactor (Section 12 - HIPAA compliance)
 *
 * Redact SSN, DOB, card numbers, NHS (UK), MRN before storage in voice_conversation_memory, transcripts.
 * Apply before appendConversationMemory and transcript storage.
 *
 * Edge cases (Gap Analysis):
 * - SSN, DOB, credit card (standard US)
 * - NHS number (UK): 3 3 4 digit groups
 * - Canadian SIN: 3-3-3
 * - MRN: "MRN" or "medical record number" followed by 6-10 digits
 * - Redaction log: counts by type for audit (not content)
 */

const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const SSN_REPLACEMENT = '[SSN-REDACTED]';

const DOB_REGEX = /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](\d{4}|\d{2})\b/g;
const DOB_REPLACEMENT = '[DOB-REDACTED]';

const CARD_REGEX = /\b(?:\d[ \-]*){13,19}\b/g;
const CARD_REPLACEMENT = '[CARD-REDACTED]';

// UK NHS number: 3 3 4 digits (with optional spaces/dashes)
const NHS_REGEX = /\b\d{3}[\s\-]?\d{3}[\s\-]?\d{4}\b/g;
const NHS_REPLACEMENT = '[NHS_NUMBER]';

// Canadian SIN: 123-456-789
const SIN_REGEX = /\b\d{3}-\d{3}-\d{3}\b/g;
const SIN_REPLACEMENT = '[SIN]';

// MRN: "MRN" or "medical record number" followed by 6-10 digits
const MRN_REGEX = /\b(MRN|mrn|medical\s*record\s*number)[:\s]+(\d{6,10})\b/gi;

function redactSSN(text) {
  if (typeof text !== 'string') return text;
  return text.replace(SSN_REGEX, SSN_REPLACEMENT);
}

function redactDOB(text) {
  if (typeof text !== 'string') return text;
  return text.replace(DOB_REGEX, DOB_REPLACEMENT);
}

function redactCard(text) {
  if (typeof text !== 'string') return text;
  return text.replace(CARD_REGEX, CARD_REPLACEMENT);
}

function redactNHS(text) {
  if (typeof text !== 'string') return text;
  return text.replace(NHS_REGEX, NHS_REPLACEMENT);
}

function redactSIN(text) {
  if (typeof text !== 'string') return text;
  return text.replace(SIN_REGEX, SIN_REPLACEMENT);
}

function redactMRN(text) {
  if (typeof text !== 'string') return text;
  return text.replace(MRN_REGEX, (match, prefix) => `${prefix} [MRN]`);
}

/**
 * Redact all PII patterns. Order matters: more specific patterns first.
 */
function redact(text) {
  if (text == null) return text;
  if (typeof text !== 'string') return text;
  return redactMRN(redactSIN(redactNHS(redactCard(redactDOB(redactSSN(text))))));
}

/**
 * Redact with audit counts. Returns { redacted, counts } for optional pii_redaction_log.
 * Does not log content, only counts by type.
 */
function redactWithLog(text) {
  if (text == null) return { redacted: text, counts: {} };
  if (typeof text !== 'string') return { redacted: text, counts: {} };

  const counts = { SSN: 0, DOB: 0, CARD: 0, NHS_NUMBER: 0, SIN: 0, MRN: 0 };
  let redacted = text;

  redacted = redacted.replace(SSN_REGEX, () => { counts.SSN++; return SSN_REPLACEMENT; });
  redacted = redacted.replace(DOB_REGEX, () => { counts.DOB++; return DOB_REPLACEMENT; });
  redacted = redacted.replace(CARD_REGEX, () => { counts.CARD++; return CARD_REPLACEMENT; });
  redacted = redacted.replace(NHS_REGEX, () => { counts.NHS_NUMBER++; return NHS_REPLACEMENT; });
  redacted = redacted.replace(SIN_REGEX, () => { counts.SIN++; return SIN_REPLACEMENT; });
  redacted = redacted.replace(MRN_REGEX, (_match, prefix) => { counts.MRN++; return `${prefix} [MRN]`; });

  const nonZero = Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0));
  if (Object.keys(nonZero).length > 0) {
    try {
      console.log('PII redacted:', nonZero);
    } catch (_) {}
  }
  return { redacted, counts: nonZero };
}

module.exports = {
  redact,
  redactWithLog,
  redactSSN,
  redactDOB,
  redactCard,
  redactNHS,
  redactSIN,
  redactMRN
};
