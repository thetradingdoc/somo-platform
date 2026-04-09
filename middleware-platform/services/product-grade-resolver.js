'use strict';

function confidenceFromSignals(score) {
  if (score >= 3) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

function resolveProductGrade({ productName, labels, categories, ingredients }) {
  const name = String(productName || '').toLowerCase();
  const labs = (Array.isArray(labels) ? labels : []).map((x) => String(x).toLowerCase());
  const cats = (Array.isArray(categories) ? categories : []).map((x) => String(x).toLowerCase());
  const ings = (Array.isArray(ingredients) ? ingredients : []).map((x) => String(x).toLowerCase());
  const blob = [name].concat(labs, cats, ings).join(' ');

  const rxSignals = [
    /\bprescription\b/,
    /\brx\b/,
    /\btretinoin\b/,
    /\bhydroquinone\s*4%?\b/
  ];
  const otcSignals = [
    /\bdrug facts\b/,
    /\bover-the-counter\b/,
    /\badapalene\b/,
    /\bbenzoyl peroxide\b/,
    /\bsalicylic acid\b.*\b(acne|treatment)\b/,
    /\bspf\b/
  ];
  const professionalSignals = [
    /\bprofessional\b/,
    /\bpro strength\b/,
    /\bclinic\b/,
    /\bmedical[-\s]?grade\b/
  ];

  const count = (arr) => arr.reduce((n, re) => n + (re.test(blob) ? 1 : 0), 0);
  const rx = count(rxSignals);
  const otc = count(otcSignals);
  const pro = count(professionalSignals);

  if (rx > 0) return { grade_class: 'MEDICAL_RX', confidence: confidenceFromSignals(rx), rationale: ['rx_signal_detected'] };
  if (otc > 0) return { grade_class: 'OTC_DRUG', confidence: confidenceFromSignals(otc), rationale: ['otc_signal_detected'] };
  if (pro > 0) return { grade_class: 'PROFESSIONAL', confidence: confidenceFromSignals(pro), rationale: ['professional_signal_detected'] };
  if (/\bcosmeceutical\b|\bclinical\b|\bdermatologist tested\b/.test(blob)) {
    return { grade_class: 'COSMECEUTICAL_MARKETING', confidence: 'medium', rationale: ['marketing_grade_signal'] };
  }
  return { grade_class: 'GENERAL_COSMETIC', confidence: 'medium', rationale: ['default_cosmetic'] };
}

module.exports = { resolveProductGrade };
