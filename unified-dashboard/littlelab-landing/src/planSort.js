/**
 * Client-side plan ordering and need-match metadata for navigator results.
 */

export function computePlanMatchMeta(plan, selectedNeeds) {
  const needs = Array.isArray(selectedNeeds) ? selectedNeeds : [];
  const coverage = plan?.coverage_detail || {};
  let matchedCount = 0;
  for (const needId of needs) {
    if (coverage[needId]?.covered === true) matchedCount += 1;
  }
  const n = needs.length;
  let status = 'partial';
  if (n === 0) {
    status = 'best';
  } else if (matchedCount === n) {
    status = 'best';
  } else {
    status = 'partial';
  }
  return { matchedCount, status };
}

function sortTuple(plan, sortBy, selectedNeeds) {
  const premium = Number(plan?.monthly_premium || 0);
  const stars = Number(plan?.star_rating || 0);
  const moop = Number(plan?.moop_amount);
  const moopSort = Number.isFinite(moop) ? moop : Number.MAX_SAFE_INTEGER;
  const meta = computePlanMatchMeta(plan, selectedNeeds);

  switch (String(sortBy || '').trim()) {
    case 'highest_stars':
      return [-stars, premium, moopSort];
    case 'lowest_moop':
      return [moopSort, premium, -stars];
    case 'lowest_premium':
      return [premium, -stars, moopSort];
    case 'coverage':
      return [-meta.matchedCount, premium, -stars];
    case 'premium':
    default:
      return [premium, -stars, moopSort];
  }
}

export function sortPlansByMode(plans, sortBy, selectedNeeds) {
  const list = Array.isArray(plans) ? [...plans] : [];
  list.sort((a, b) => {
    const ka = sortTuple(a, sortBy, selectedNeeds);
    const kb = sortTuple(b, sortBy, selectedNeeds);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
  });
  return list;
}
