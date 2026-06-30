'use strict';

const {
  emptyAccumulator,
  mergeAccumulator,
  applyFieldUtterance,
  filledCount,
  OPQRST_FIELDS,
  FIELD_KEYS
} = require('../conversation-mode/opqrst-accumulator');

const FIELD_PATTERNS = {
  O: /\b(started|began|onset|since|for \d+ day|yesterday|today|this morning)\b/i,
  P: /\b(worse|better|when|after|before|moving|eating|touching)\b/i,
  Q: /\b(sharp|dull|burning|itching|throbbing|stabbing|pressure)\b/i,
  R: /\b(chest|arm|leg|head|back|stomach|abdomen|face|skin|rash)\b/i,
  S: /\b(\d+\/10|mild|moderate|severe|unbearable|scale)\b/i,
  T: /\b(constant|intermittent|comes and goes|always|sometimes|at night)\b/i
};

const NEGATION_PATTERNS = [
  { key: 'fever_absent', pattern: /\b(no fever|without fever|haven'?t had a fever|no temperature)\b/i },
  { key: 'trauma_absent', pattern: /\b(no injury|no trauma|didn'?t hurt myself|no accident)\b/i },
  { key: 'breathing_normal', pattern: /\b(no trouble breathing|breathing (is )?fine|not short of breath)\b/i },
  { key: 'bleeding_absent', pattern: /\b(no bleeding|not bleeding)\b/i },
  { key: 'rash_absent', pattern: /\b(no rash|don'?t have a rash|without rash)\b/i }
];

function inferFieldFromText(text) {
  const t = String(text || '');
  for (const f of OPQRST_FIELDS) {
    if (FIELD_PATTERNS[f].test(t)) return f;
  }
  return null;
}

function parseNegations(utterance) {
  const t = String(utterance || '');
  const negations = {};
  for (const { key, pattern } of NEGATION_PATTERNS) {
    if (pattern.test(t)) negations[key] = true;
  }
  return negations;
}

function updateFromUtterance(metadata = {}, utterance) {
  const existing = metadata.opqrst || emptyAccumulator();
  const field = inferFieldFromText(utterance);
  const next = field
    ? applyFieldUtterance(existing, field, utterance)
    : mergeAccumulator(existing);
  const negations = { ...(metadata.negations || {}), ...parseNegations(utterance) };
  return {
    ...metadata,
    opqrst: next,
    opqrst_filled_count: filledCount(next),
    negations
  };
}

function toReportSection(opqrst = {}, negations = {}) {
  const out = {};
  for (const f of OPQRST_FIELDS) {
    const key = FIELD_KEYS[f];
    const val = opqrst[f] || opqrst[key];
    if (val) out[key] = val;
  }
  if (Object.keys(negations).length) out.negations = negations;
  return out;
}

function formatOpqrstForPrompt(metadata = {}) {
  const opqrst = metadata.opqrst || {};
  const negations = metadata.negations || {};
  const lines = [];
  for (const f of OPQRST_FIELDS) {
    const key = FIELD_KEYS[f];
    const val = opqrst[f] || opqrst[key];
    lines.push(`${key}: ${val || '(not yet collected)'}`);
  }
  const negKeys = Object.keys(negations).filter((k) => negations[k]);
  if (negKeys.length) {
    lines.push(`Patient denied: ${negKeys.join(', ')}`);
  }
  return lines.join('\n');
}

module.exports = {
  updateFromUtterance,
  toReportSection,
  parseNegations,
  formatOpqrstForPrompt,
  emptyAccumulator,
  OPQRST_FIELDS
};
