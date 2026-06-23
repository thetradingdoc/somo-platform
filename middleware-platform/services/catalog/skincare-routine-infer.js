'use strict';

/**
 * Lightweight keyword → canonical id (cosing:inci) for graph checks when the session
 * has no explicit ingredient id list. Conservative: only emits ids present in the conflict seed.
 */

function inferCanonicalIngredientIdsFromText(text) {
  const t = String(text || '').toLowerCase();
  const out = new Set();
  if (/\bretinol\b/.test(t)) out.add('cosing:retinol');
  if (/\btretinoin\b/.test(t)) out.add('cosing:tretinoin');
  if (/\b(glycolic acid|glycolic)\b/.test(t)) out.add('cosing:glycolic acid');
  if (/\blactic acid\b/.test(t)) out.add('cosing:lactic acid');
  if (/\bmandelic acid\b/.test(t)) out.add('cosing:mandelic acid');
  if (/\b(salicylic acid|salicylic)\b/.test(t)) out.add('cosing:salicylic acid');
  if (/\b(bha|beta hydroxy)\b/.test(t)) out.add('cosing:salicylic acid');
  if (/\b(ascorbic acid|l-ascorbic|vitamin c)\b/.test(t)) out.add('cosing:ascorbic acid');
  if (/\bniacinamide\b/.test(t)) out.add('cosing:niacinamide');
  if (/\b(benzoyl peroxide|benzoyl)\b/.test(t)) out.add('cosing:benzoyl peroxide');
  if (/\bcopper (tripeptide|peptide)/.test(t) || /\bcopper tripeptide-1\b/.test(t)) {
    out.add('cosing:copper tripeptide-1');
  }
  return [...out];
}

module.exports = {
  inferCanonicalIngredientIdsFromText
};
