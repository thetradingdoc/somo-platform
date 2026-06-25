'use strict';

const {
  emptyAccumulator,
  mergeAccumulator,
  applyFieldUtterance,
  filledCount,
  OPQRST_FIELDS,
  FIELD_KEYS
} = require('./conversation-mode/opqrst-accumulator');

const FIELD_PATTERNS = {
  O: /\b(started|began|onset|since|for \d+ day|yesterday|today|this morning)\b/i,
  P: /\b(worse|better|when|after|before|moving|eating|touching)\b/i,
  Q: /\b(sharp|dull|burning|itching|throbbing|stabbing|pressure)\b/i,
  R: /\b(chest|arm|leg|head|back|stomach|abdomen|face|skin|rash)\b/i,
  S: /\b(\d+\/10|mild|moderate|severe|unbearable|scale)\b/i,
  T: /\b(constant|intermittent|comes and goes|always|sometimes|at night)\b/i
};

function inferFieldFromText(text) {
  const t = String(text || '');
  for (const f of OPQRST_FIELDS) {
    if (FIELD_PATTERNS[f].test(t)) return f;
  }
  return null;
}

function updateFromUtterance(metadata = {}, utterance) {
  const existing = metadata.opqrst || emptyAccumulator();
  const field = inferFieldFromText(utterance);
  const next = field
    ? applyFieldUtterance(existing, field, utterance)
    : mergeAccumulator(existing);
  return {
    ...metadata,
    opqrst: next,
    opqrst_filled_count: filledCount(next)
  };
}

function toReportSection(opqrst = {}) {
  const out = {};
  for (const f of OPQRST_FIELDS) {
    const key = FIELD_KEYS[f];
    const val = opqrst[f] || opqrst[key];
    if (val) out[key] = val;
  }
  return out;
}

module.exports = {
  updateFromUtterance,
  toReportSection,
  emptyAccumulator,
  OPQRST_FIELDS
};
