'use strict';

const { classifyDermPatientQA } = require('../shared/derm-patient-qa-triage');

const DIAGNOSIS_ONLY_RE =
  /\b(what is|what's|is this|does this look like|could this be|diagnos|wart on|genital|should i be worried)\b/i;

const INFANT_RE =
  /\b(infant|newborn|baby|toddler|month old|months old)\b/i;

const CLEAR_CONCERN_RE =
  /\b(acne|rosacea|melasma|eczema|hyperpigment|dark spot|wrinkle|barrier|redness|breakout|pimple|cystic|purging)\b/i;

const CATALOG_ENRICH_TERMS = {
  anti_aging: ['wrinkle', 'fine line', 'retinoid', 'texture'],
  acne: ['acne', 'breakout', 'tretinoin', 'purging', 'retinoid'],
  hyperpigmentation: ['dark spot', 'hyperpigment', 'melasma', 'pih'],
  barrier_repair: ['barrier', 'dry', 'flaky', 'sensitive', 'eczema'],
  rosacea: ['rosacea', 'redness', 'flush', 'erythema'],
};

function formatClarifyAsIntake(clarifyAnswers) {
  if (!clarifyAnswers || typeof clarifyAnswers !== 'object') return null;
  const slots = {};
  if (clarifyAnswers.duration) slots.duration = clarifyAnswers.duration;
  if (clarifyAnswers.location) slots.location = clarifyAnswers.location;
  if (clarifyAnswers.changing) slots.changing = clarifyAnswers.changing;
  if (clarifyAnswers.on_prescription) slots.on_prescription = clarifyAnswers.on_prescription;
  return Object.keys(slots).length ? slots : null;
}

function hasMeaningfulClarify(clarifyAnswers) {
  if (!clarifyAnswers || typeof clarifyAnswers !== 'object') return false;
  return !!(clarifyAnswers.duration || clarifyAnswers.location || clarifyAnswers.changing);
}

/**
 * Append clinical tokens for catalog scoring (gap-file clinical variant pattern).
 */
function enrichInquiryForMatch(inquiry, derm) {
  const base = String(inquiry || '').trim();
  const sub = String(derm?.subkind || '').toLowerCase();
  const intent = String(derm?.intent || '').toLowerCase();
  if (!base && intent !== 'routine') return base;

  const extras = [];
  if (intent === 'routine' || sub.includes('retinoid') || sub.includes('product')) {
    extras.push('retinoid', 'routine', 'skincare');
  }
  if (sub.includes('retinoid')) extras.push('tretinoin', 'purging', 'acne');
  const lower = base.toLowerCase();
  if (lower.includes('purging') || lower.includes('cystic')) extras.push('acne', 'breakout', 'pimple');
  for (const terms of Object.values(CATALOG_ENRICH_TERMS)) {
    for (const t of terms) {
      if (lower.includes(t)) extras.push(t);
    }
  }

  const unique = [...new Set(extras)].filter((t) => t && !lower.includes(t));
  if (!unique.length) return base;
  return `${base} ${unique.join(' ')}`.trim();
}

/**
 * Map existing derm patient Q&A triage to funnel routes (no duplicate rule engine).
 *
 * @returns {{ action: 'continue'|'specialist'|'clarify', copy?: string, rationale?: string, derm: object|null, enriched_inquiry: string, derm_intent?: string|null }}
 */
function runClinicalTriage({ inquiry = '', concern_chip = null, clarify_answers = null, user_goal = 'track_program' } = {}) {
  const text = String(inquiry || '').trim();

  if (user_goal === 'find_specialist') {
    return { action: 'continue', enriched_inquiry: text, derm: null, rationale: null, copy: null, derm_intent: null };
  }

  if (clarify_answers && String(clarify_answers.on_prescription || '') === 'yes') {
    return {
      action: 'specialist',
      copy: 'Active prescriptions are best managed with a clinician before starting a self-guided program.',
      rationale: 'clarify_on_prescription|clinical',
      derm: null,
      enriched_inquiry: text,
      derm_intent: null,
    };
  }

  const derm = classifyDermPatientQA({
    message: text,
    structuredIntake: formatClarifyAsIntake(clarify_answers),
  });

  const dermIntent = derm?.intent || null;
  const systemic = derm?.systemic_assessment || {};
  const rationalePrefix = `clinical|derm:${dermIntent}`;

  if (systemic.is_emergency || dermIntent === 'urgent') {
    return {
      action: 'specialist',
      copy:
        'Based on what you described, we recommend in-person care rather than a self-guided program alone.',
      rationale: `${rationalePrefix}|urgent`,
      derm,
      enriched_inquiry: text,
      derm_intent: dermIntent,
    };
  }

  if (dermIntent === 'off_topic') {
    return {
      action: 'specialist',
      copy: 'This is outside our self-guided skin programs — a specialist is the right next step.',
      rationale: `${rationalePrefix}|off_topic`,
      derm,
      enriched_inquiry: text,
      derm_intent: dermIntent,
    };
  }

  if (INFANT_RE.test(text)) {
    return {
      action: 'specialist',
      copy: 'Care for infants and young children should be guided by a clinician.',
      rationale: `${rationalePrefix}|infant`,
      derm,
      enriched_inquiry: text,
      derm_intent: dermIntent,
    };
  }

  if (DIAGNOSIS_ONLY_RE.test(text) && !concern_chip) {
    return {
      action: 'specialist',
      copy: 'We cannot diagnose from text alone — a specialist can evaluate this in person.',
      rationale: `${rationalePrefix}|diagnosis_only`,
      derm,
      enriched_inquiry: text,
      derm_intent: dermIntent,
    };
  }

  if (derm.needs_clarification && !concern_chip && !hasMeaningfulClarify(clarify_answers)) {
    const rationale = derm.triage_rationale || [];
    const tooShortOnly =
      rationale.some((r) => String(r).includes('too_short')) && rationale.length <= 2;
    if (tooShortOnly && (CLEAR_CONCERN_RE.test(text) || text.length >= 10)) {
      return {
        action: 'continue',
        enriched_inquiry: enrichInquiryForMatch(text, derm),
        derm,
        rationale: `${rationalePrefix}|skipped_too_short`,
        copy: null,
        derm_intent: dermIntent,
      };
    }
    return {
      action: 'clarify',
      copy:
        derm.clarifying_hint ||
        'A few quick answers help us route you to the right care plan or specialist.',
      rationale: `${rationalePrefix}|needs_clarification`,
      derm,
      enriched_inquiry: text,
      derm_intent: dermIntent,
    };
  }

  return {
    action: 'continue',
    enriched_inquiry: enrichInquiryForMatch(text, derm),
    derm,
    rationale: rationalePrefix,
    copy: null,
    derm_intent: dermIntent,
  };
}

module.exports = {
  runClinicalTriage,
  enrichInquiryForMatch,
  formatClarifyAsIntake,
  DIAGNOSIS_ONLY_RE,
};
