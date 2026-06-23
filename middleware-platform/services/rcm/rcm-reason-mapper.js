/**
 * RCM Denial Reason Mapper (CARC/RARC → plain English)
 *
 * Keep this intentionally conservative and non-PHI:
 * - It explains what a denial code generally means
 * - It does not infer clinical facts
 */

const CARC = {
  'CO-16': 'The claim is missing required information (for example, the provider NPI or signature).',
  'CO-45': 'The charge exceeds the maximum allowable amount under your contract.',
  'CO-97': 'The service is not payable because the documentation or conditions were not met.',
  'PR-1': 'Deductible amount.',
  'PR-2': 'Coinsurance amount.',
  'PR-3': 'Copayment amount.'
};

function normalizeCode(code) {
  return (code || '').toString().trim().toUpperCase();
}

function mapCarc(code) {
  const c = normalizeCode(code);
  return CARC[c] || null;
}

/**
 * Build a short, patient-safe explanation from denial codes + optional remark text.
 * @param {object} params
 * @param {string} [params.carc]
 * @param {string} [params.rarc]
 * @param {string} [params.remark]
 * @returns {{ summary: string, carc?: string, carc_text?: string, remark?: string }}
 */
function explainDenial({ carc, rarc, remark } = {}) {
  const carcNorm = normalizeCode(carc);
  const carcText = carcNorm ? mapCarc(carcNorm) : null;

  const parts = [];
  if (carcText) parts.push(carcText);
  if (!carcText && carcNorm) parts.push('The payer reported an adjustment/denial based on claim rules.');
  if (remark) parts.push(String(remark).trim());

  return {
    summary: parts.filter(Boolean).join(' '),
    ...(carcNorm && { carc: carcNorm }),
    ...(carcText && { carc_text: carcText }),
    ...(remark && { remark: String(remark).trim() }),
    ...(rarc && { rarc: normalizeCode(rarc) })
  };
}

module.exports = {
  mapCarc,
  explainDenial
};

