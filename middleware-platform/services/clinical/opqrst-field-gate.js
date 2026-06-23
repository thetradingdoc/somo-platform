'use strict';

/**
 * OpqrstFieldGate — single coordinator for OPQRST field state.
 * SSOT: triage_sessions row only (never L4 state.step for fill/missing).
 */

const { isOpqrstFieldGateEnabled } = require('../kelly/rails/config');
const { getNextQuestion } = require('./clinical-opqrst-registry');
const { PAYMENT_SIGNALS, RECORDS_SIGNALS } = require('../kelly/rails/state-schema');
const Metrics = require('../shared/metrics');

const FIELD_DEFS = [
  {
    field: 'onset',
    stepId: 'opqrst_onset',
    questionRe: /when did .* start|when .* start|when did this start/i
  },
  {
    field: 'provocation',
    stepId: 'opqrst_provocation',
    questionRe: /better or worse|makes .* better|makes .* worse|rest help|light or movement|what makes it/i,
    skippableWhenPolicyOptional: true
  },
  {
    field: 'quality',
    stepId: 'opqrst_quality',
    questionRe: /what .* feel like|describe what it feels|sharp|dull|throbbing|pressure|burning|quality/i
  },
  {
    field: 'radiation',
    stepId: 'opqrst_radiation',
    questionRe: /spread anywhere|does it spread|radiation/i,
    skipForSpecialty: /psychiatr|mental health|mood|anxiety|depression/i
  },
  {
    field: 'severity',
    stepId: 'opqrst_severity',
    questionRe: /scale of 1 to 10|1 to 10|how bad|how severe|severity/i
  },
  {
    field: 'timing',
    stepId: 'opqrst_timing',
    questionRe: /constant or comes and goes|comes and goes|is it constant|timing|come and go/i
  }
];

const BOOKING_TANGENT_RE =
  /\b(book|schedule|appointment|slot|tomorrow|available time|when can i book|can i book)\b/i;
const CANCEL_RESCHEDULE_RE = /\b(cancel|reschedule|move my appointment|change my appointment)\b/i;
const META_QUESTION_RE =
  /^(what|why|how|huh|sorry)\??$|what do you mean|why do you need|what does that mean|can you explain/i;
const EMPTY_UTTERANCE_RE = /^(uh+h?|uh-?huh|um+|hmm+|ok+|yeah?|yep|mhm)\.?$/i;

function hasText(v) {
  if (v == null) return false;
  return String(v).trim().length > 0;
}

function normalizeSpecialty(specialty) {
  return String(specialty || '').trim();
}

function isPsychiatrySpecialty(specialty) {
  return /psychiatr|mental health|mood|anxiety|depression/i.test(normalizeSpecialty(specialty));
}

/**
 * Unified OPQRST completion (P-2).
 * @param {object|null} row - triage_sessions row
 * @param {{ triagePolicy?: string, specialty?: string }} opts
 */
function opqrstComplete(row, opts = {}) {
  if (!row) return false;
  const triagePolicy = String(opts.triagePolicy || 'conditional').toLowerCase();
  const hasOnset = hasText(row.onset);
  const hasQuality = hasText(row.quality);
  const hasSeverity = row.severity != null && row.severity !== '';
  const hasTiming = hasText(row.timing);
  const hasProvocation = hasText(row.provocation);

  let complete = hasOnset && hasQuality && hasSeverity && hasTiming;
  if (triagePolicy === 'required') {
    complete = complete && hasProvocation;
  }
  const specialty = opts.specialty || row?.target_specialty;
  if (isOpqrstFieldGateEnabled() && complete && !isPsychiatrySpecialty(specialty)) {
    complete = complete && hasText(row.radiation);
  }
  return complete;
}

function fieldFilled(row, field) {
  if (!row) return false;
  if (field === 'severity') {
    return row.severity != null && row.severity !== '';
  }
  return hasText(row[field]);
}

function firstOpenField(row, { triagePolicy, specialty, opqrstResumeField } = {}) {
  if (opqrstResumeField) {
    const def = FIELD_DEFS.find((d) => d.field === opqrstResumeField);
    if (def && !fieldFilled(row, def.field)) {
      if (def.skipForSpecialty && isPsychiatrySpecialty(specialty)) return null;
      return def.field;
    }
  }
  for (const def of FIELD_DEFS) {
    if (def.skipForSpecialty && isPsychiatrySpecialty(specialty)) continue;
    if (def.skippableWhenPolicyOptional && triagePolicy !== 'required' && fieldFilled(row, def.field)) {
      continue;
    }
    if (!fieldFilled(row, def.field)) return def.field;
  }
  return null;
}

function fieldDefForName(name) {
  return FIELD_DEFS.find((d) => d.field === name) || null;
}

function isHardTangent(message) {
  const msg = String(message || '').toLowerCase();
  if (PAYMENT_SIGNALS.some((s) => msg.includes(s))) return true;
  if (RECORDS_SIGNALS.some((s) => msg.includes(s))) return true;
  if (BOOKING_TANGENT_RE.test(msg)) return true;
  if (CANCEL_RESCHEDULE_RE.test(msg)) return true;
  if (/\b(insurance cover|member id|copay|deductible|receipt|claim status)\b/i.test(msg)) return true;
  return false;
}

function isMetaQuestion(message) {
  const msg = String(message || '').trim();
  if (!msg) return false;
  return META_QUESTION_RE.test(msg);
}

function isEmptyUtterance(message) {
  const msg = String(message || '').trim();
  if (!msg) return true;
  return EMPTY_UTTERANCE_RE.test(msg);
}

function lastAssistantAskedField(lastAssistantText, openField) {
  const def = fieldDefForName(openField);
  if (!def) return false;
  return def.questionRe.test(String(lastAssistantText || '').toLowerCase());
}

function extractProvocationAnswer(message) {
  const msg = String(message || '').trim();
  if (!msg) return null;
  const patterns = [
    /(?:walking|walk|movement|moving)\s+makes?\s+it\s+worse/i,
    /(?:sitting|rest|lying down)\s+helps?/i,
    /(?:standing|upright)\s+(?:is\s+)?worse/i,
    /(?:better|worse)\s+(?:when|with|if)\s+[^.?]+/i,
    /(?:or\s+)?does\s+walking\s+make\s+it\s+worse/i
  ];
  for (const re of patterns) {
    const m = msg.match(re);
    if (m) return m[0].trim();
  }
  if (/nothing really|not really|none/i.test(msg)) return msg;
  return null;
}

const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

function parseSeverityFromMessage(message) {
  const msg = String(message || '').trim();
  if (!msg) return null;
  const digit = msg.match(/\b(10|[1-9])\b/);
  if (digit) return parseInt(digit[1], 10);
  const word = msg.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (word) return WORD_NUMBERS[String(word[1]).toLowerCase()] || null;
  return null;
}

function messageAnswersOpenField(openField, message) {
  const msg = String(message || '').trim();
  if (!msg || isHardTangent(msg) || isMetaQuestion(msg)) return false;
  switch (openField) {
    case 'onset':
      return /since|started|this morning|yesterday|last night|for \d+ days?|a week ago|few days|couple of days/i.test(msg);
    case 'quality':
      return /feels like|feeling|aching|sharp|dull|burning|pressure|throbbing|cramp|stabbing/i.test(msg);
    case 'severity':
      return parseSeverityFromMessage(msg) != null;
    case 'timing':
      return /constant|comes and goes|intermittent|off and on|all the time|steady/i.test(msg);
    case 'provocation':
      return /better|worse|helps?|hurt|movement|rest|nothing really|not really/i.test(msg);
    default:
      return false;
  }
}

function buildStorePayload(openField, message, classification) {
  const msg = String(message || '').trim();
  if (!msg || classification === 'tangent') return null;

  if (openField === 'severity') {
    const sev = parseSeverityFromMessage(msg);
    if (sev != null) return { severity: sev };
  }

  if (openField === 'onset') {
    const m = msg.match(
      /(this morning|yesterday|last night|since[^.?]{0,40}|started[^.?]{0,40}|for \d+ days?|a week ago|few days|couple of days)/i
    );
    if (m) return { onset: m[1].trim() };
  }

  if (openField === 'quality') {
    const m = msg.match(/(aching|sharp|dull|burning|pressure|throbbing|cramp|stabbing|cramping)/i);
    if (m) return { quality: m[1].trim() };
  }

  if (openField === 'timing') {
    if (/constant|all the time|steady/i.test(msg)) return { timing: 'constant' };
    if (/comes and goes|intermittent|off and on/i.test(msg)) return { timing: 'intermittent' };
  }

  if (openField === 'provocation') {
    const extracted = extractProvocationAnswer(msg);
    return { provocation: extracted || msg };
  }

  return { [openField]: msg };
}

/**
 * Extract every unfilled OPQRST field answerable from one utterance (voice often bundles fields).
 */
function extractOpqrstFieldsFromMessage(message, triageRow, opts = {}) {
  const triagePolicy = String(opts.triagePolicy || 'conditional').toLowerCase();
  const specialty = opts.specialty || triageRow?.target_specialty || null;
  const payload = {};
  for (const def of FIELD_DEFS) {
    if (fieldFilled(triageRow, def.field)) continue;
    if (def.skipForSpecialty && isPsychiatrySpecialty(specialty)) continue;
    if (!messageAnswersOpenField(def.field, message)) continue;
    const part = buildStorePayload(def.field, message, 'answer');
    if (part) Object.assign(payload, part);
  }
  return payload;
}

function classifyUtterance({ userMessage, lastAssistantText, openField }) {
  const msg = String(userMessage || '').trim();

  if (isEmptyUtterance(msg)) {
    return { classification: 'ambiguous', userAskedTangent: false, userAnsweredOpenField: false };
  }

  if (isHardTangent(msg)) {
    return { classification: 'tangent', userAskedTangent: true, userAnsweredOpenField: false };
  }

  if (isMetaQuestion(msg)) {
    return { classification: 'tangent', userAskedTangent: true, userAnsweredOpenField: false };
  }

  const asked = lastAssistantAskedField(lastAssistantText, openField);

  if (messageAnswersOpenField(openField, msg) && (asked || !lastAssistantText.trim())) {
    return { classification: 'answer', userAskedTangent: false, userAnsweredOpenField: true };
  }

  if (openField === 'provocation' && asked) {
    const extracted = extractProvocationAnswer(msg);
    if (extracted || /better|worse|helps?|hurt|pain when|nothing really|not really/i.test(msg)) {
      return { classification: 'answer', userAskedTangent: false, userAnsweredOpenField: true };
    }
  }

  if (asked && !isHardTangent(msg) && !isMetaQuestion(msg)) {
    return { classification: 'answer', userAskedTangent: false, userAnsweredOpenField: true };
  }

  if (/maybe|i don't know|i do not know|not sure|i think/i.test(msg) && asked) {
    return { classification: 'ambiguous', userAskedTangent: false, userAnsweredOpenField: true };
  }

  return { classification: 'ambiguous', userAskedTangent: false, userAnsweredOpenField: false };
}

function scriptedLineForField(openField, locale, specialty) {
  const def = fieldDefForName(openField);
  if (!def) return null;
  const specKey = normalizeSpecialty(specialty).toLowerCase().replace(/\s+/g, '_') || null;
  const scripted = getNextQuestion(locale, def.stepId, specKey);
  return scripted?.text || null;
}

function gateActive(input) {
  if (!isOpqrstFieldGateEnabled()) return false;
  if (input.opqrstFrozen) return false;
  if (String(input.triagePolicy || '').toLowerCase() === 'disabled') return false;
  if (String(input.activeLane || '') !== 'clinical') return false;
  const mode = String(input.conversationMode || '');
  const subrail = String(input.activeSubrail || '');
  const clinicalMode = mode === 'tenant_inbound_clinical' || subrail === 'opqrst';
  if (!clinicalMode) return false;
  if (input.symptomContextEstablished === true) return true;
  const { hasSymptomFieldsInTriage } = require('../kelly/rails/enter-clinical-lane');
  const { hasSymptomEvidence } = require('../conversation/intent-detector');
  if (hasSymptomFieldsInTriage(input.triageRow)) return true;
  if (hasSymptomEvidence(input.userMessage || '')) return true;
  return false;
}

/**
 * Main gate entry.
 */
function resolve(input = {}) {
  const triageRow = input.triageRow || null;
  const triagePolicy = String(input.triagePolicy || 'conditional').toLowerCase();
  const specialty = input.specialty || triageRow?.target_specialty || null;
  const locale = String(input.locale || 'en').slice(0, 2);
  const userMessage = String(input.userMessage || '');
  const lastAssistantText = String(input.lastAssistantText || '');

  const inactive = {
    active: false,
    openField: null,
    userAnsweredOpenField: false,
    userAskedTangent: false,
    classification: null,
    shouldScriptVoice: false,
    scriptedLine: null,
    allowStoreOpqrst: false,
    storePayload: null,
    opqrstComplete: opqrstComplete(triageRow, { triagePolicy, specialty }),
    resumeFieldAfterTangent: input.opqrstResumeField || null
  };

  if (!gateActive(input)) {
    try {
      Metrics.increment('opqrst.gate_bypassed', 1);
    } catch (_) {}
    return inactive;
  }

  try {
    Metrics.increment('opqrst.gate_enabled', 1);
  } catch (_) {}

  const openField = firstOpenField(triageRow, {
    triagePolicy,
    specialty,
    opqrstResumeField: input.opqrstResumeField
  });

  const complete = opqrstComplete(triageRow, { triagePolicy, specialty });

  if (!openField || complete) {
    return {
      ...inactive,
      active: true,
      opqrstComplete: complete
    };
  }

  const { classification, userAskedTangent, userAnsweredOpenField } = classifyUtterance({
    userMessage,
    lastAssistantText,
    openField
  });

  let storePayload = null;
  if (userAnsweredOpenField && classification !== 'tangent') {
    storePayload = buildStorePayload(openField, userMessage, classification);
  }

  const shouldScriptVoice =
    !userAskedTangent &&
    !userAnsweredOpenField &&
    !storePayload &&
    !!openField &&
    !isEmptyUtterance(userMessage);

  const scriptedLine = shouldScriptVoice ? scriptedLineForField(openField, locale, specialty) : null;

  const allowStoreOpqrst = !!(storePayload && Object.keys(storePayload).length);

  if (storePayload) {
    try {
      Metrics.increment('opqrst.field_stored', 1);
      Metrics.increment(`opqrst.field_stored.${openField}`, 1);
    } catch (_) {}
  }
  if (userAskedTangent) {
    try {
      Metrics.increment('opqrst.tangent_detected', 1);
      Metrics.increment(`opqrst.tangent_detected.${classification || 'tangent'}`, 1);
    } catch (_) {}
  }
  if (!shouldScriptVoice && openField && !userAnsweredOpenField && !complete) {
    try {
      Metrics.increment('opqrst.script_suppressed', 1);
    } catch (_) {}
  }

  return {
    active: true,
    openField,
    userAnsweredOpenField,
    userAskedTangent,
    classification,
    shouldScriptVoice,
    scriptedLine,
    allowStoreOpqrst,
    storePayload,
    opqrstComplete: complete,
    resumeFieldAfterTangent: userAskedTangent ? openField : input.opqrstResumeField || null
  };
}

function hasPartialTriage(row) {
  if (!row) return false;
  return FIELD_DEFS.some((d) => fieldFilled(row, d.field));
}

module.exports = {
  isOpqrstFieldGateEnabled,
  opqrstComplete,
  resolve,
  hasPartialTriage,
  fieldFilled,
  firstOpenField,
  scriptedLineForField,
  FIELD_DEFS,
  /** @internal test hooks */
  _classifyUtterance: classifyUtterance,
  _isHardTangent: isHardTangent,
  _isMetaQuestion: isMetaQuestion,
  _buildStorePayload: buildStorePayload,
  extractOpqrstFieldsFromMessage
};
