'use strict';

const SCHEMA_VERSION = '1';

const ACTIVE_DICTIONARY = [
  { key: 'niacinamide', label: 'Niacinamide', functionTags: ['blemish_control', 'oil_balance'] },
  { key: 'hyaluronic acid', label: 'Hyaluronic Acid', functionTags: ['hydration'] },
  { key: 'sodium hyaluronate', label: 'Hyaluronic Acid', functionTags: ['hydration'] },
  { key: 'salicylic acid', label: 'Salicylic Acid', functionTags: ['blemish_control', 'exfoliation'] },
  { key: 'retinol', label: 'Retinol', functionTags: ['anti_aging'] },
  { key: 'tretinoin', label: 'Tretinoin', functionTags: ['anti_aging', 'blemish_control'] },
  { key: 'azelaic acid', label: 'Azelaic Acid', functionTags: ['blemish_control', 'tone_evening'] },
  { key: 'vitamin c', label: 'Vitamin C', functionTags: ['tone_evening', 'antioxidant'] },
  { key: 'ascorbic acid', label: 'Vitamin C', functionTags: ['tone_evening', 'antioxidant'] },
  { key: 'glycerin', label: 'Glycerin', functionTags: ['hydration'] },
  { key: 'ceramide', label: 'Ceramides', functionTags: ['barrier_support'] },
  { key: 'zinc pca', label: 'Zinc PCA', functionTags: ['oil_balance', 'blemish_control'] }
];

function mkTile({ status, source, confidence = null, value = null, reason = null }) {
  return {
    status,
    source,
    confidence,
    value,
    reason_unavailable: reason
  };
}

function parseIngredients(ingredientsText) {
  return String(ingredientsText || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractConcentration(text) {
  const m = String(text || '').match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  return m ? `${m[1]}%` : null;
}

function extractKeyActives(ingredientsText) {
  const raw = parseIngredients(ingredientsText);
  const joined = raw.join(', ').toLowerCase();
  const seen = new Set();
  const out = [];
  for (const entry of ACTIVE_DICTIONARY) {
    if (!joined.includes(entry.key)) continue;
    if (seen.has(entry.label)) continue;
    seen.add(entry.label);
    const near = raw.find((x) => x.toLowerCase().includes(entry.key)) || entry.key;
    const concentration = extractConcentration(near);
    out.push({
      name: entry.label,
      concentration,
      display: concentration ? `${entry.label} ${concentration}` : entry.label
    });
  }
  return out.slice(0, 6);
}

function classifyFormulation(ingredientsText) {
  const firstFew = parseIngredients(ingredientsText).slice(0, 5).map((x) => x.toLowerCase());
  if (!firstFew.length) return null;
  const joined = firstFew.join(' ');
  if (/\b(aqua|water)\b/.test(firstFew[0] || '')) return { label: 'Water-Based', confidence: 'medium' };
  if (/\b(oil|argania|jojoba|squalane)\b/.test(joined)) return { label: 'Oil-Based', confidence: 'low' };
  if (/\b(cetearyl|stearic|cetyl|emulsif)\b/.test(joined)) return { label: 'Emulsion/Cream', confidence: 'low' };
  return { label: 'Unknown', confidence: 'low' };
}

/** Food/supplement: avoid skincare “water-based” wording; still deterministic from first ingredients. */
function classifyFoodOrSupplementFormulation(ingredientsText) {
  const firstFew = parseIngredients(ingredientsText).slice(0, 5).map((x) => x.toLowerCase());
  if (!firstFew.length) return null;
  const joined = firstFew.join(' ');
  if (/\b(aqua|water)\b/.test(firstFew[0] || '')) return { label: 'Liquid (water first)', confidence: 'low' };
  if (/\b(oil|fat|butter|cream|milk)\b/.test(joined)) return { label: 'Fat / oil-containing', confidence: 'low' };
  return { label: 'Mixed food / beverage', confidence: 'low' };
}

function mapFunctionFromActives(actives, categoryRoute) {
  if (!Array.isArray(actives) || !actives.length) return [];
  const f = new Set();
  const byName = new Map(ACTIVE_DICTIONARY.map((x) => [x.label, x.functionTags]));
  for (const a of actives) {
    const tags = byName.get(a.name) || [];
    tags.forEach((t) => f.add(t));
  }
  if (categoryRoute === 'hygiene') f.add('daily_cleansing');
  if (categoryRoute === 'supplement') f.add('nutrition_support');
  return [...f].slice(0, 5);
}

function describeProductFunction(categoryRoute, functionTags = []) {
  if (Array.isArray(functionTags) && functionTags.length) {
    return `Targets ${functionTags.slice(0, 2).map((x) => String(x).replace(/_/g, ' ')).join(' and ')}.`;
  }
  const byRoute = {
    cosmetic: 'Topical cosmetic care product.',
    hygiene: 'Daily hygiene and cleansing support.',
    food: 'Food/beverage item, not a topical skincare treatment.',
    supplement: 'Oral supplement support product.',
    non_food: 'Non-food household/personal care item.',
    unknown: 'Insufficient category detail yet.'
  };
  return byRoute[categoryRoute] || byRoute.unknown;
}

function buildDeterministicAlternatives({ categoryRoute, functionTags = [] }) {
  if (categoryRoute === 'unknown') {
    return {
      status: 'deferred',
      source: 'none',
      policy: 'ask_kelly',
      reason_unavailable: 'category_unknown'
    };
  }
  const tags = new Set(functionTags || []);
  const candidates = [];
  if (tags.has('barrier_support') || tags.has('hydration')) {
    candidates.push('Fragrance-free ceramide moisturizer');
  }
  if (tags.has('blemish_control') || tags.has('oil_balance')) {
    candidates.push('Low-irritation niacinamide serum');
  }
  if (tags.has('tone_evening')) {
    candidates.push('Vitamin C derivative serum');
  }
  if (!candidates.length && categoryRoute === 'hygiene') {
    candidates.push('Sulfate-free gentle cleanser');
  }
  if (!candidates.length && categoryRoute === 'cosmetic') {
    candidates.push('Sensitive-skin fragrance-free formula');
  }
  return candidates.length
    ? {
        status: 'available',
        source: 'deterministic',
        policy: 'deterministic_catalog',
        candidates: candidates.slice(0, 3),
        reason_unavailable: null
      }
    : {
        status: 'deferred',
        source: 'none',
        policy: 'ask_kelly',
        reason_unavailable: 'insufficient_data'
      };
}

function buildScanSummary({
  product = {},
  categoryRoute = 'unknown',
  categoryRouteSource = null,
  categoryRouteRuleId = null,
  catalogSource = null
}) {
  const generatedAt = new Date().toISOString();
  const ingredientsText = String(product.ingredients_text || '');
  const actives = extractKeyActives(ingredientsText);
  const formulation = classifyFormulation(ingredientsText);
  const foodFormulation = classifyFoodOrSupplementFormulation(ingredientsText);
  const fn = mapFunctionFromActives(actives, categoryRoute);
  const hasIngredients = !!ingredientsText.trim();
  const isFoodOrSupplement = categoryRoute === 'food' || categoryRoute === 'supplement';
  const noCosmeticActivesButHasText = hasIngredients && !actives.length;

  const keyActivesTile = (() => {
    if (!hasIngredients) return mkTile({ status: 'unavailable', source: 'none', reason: 'missing_ingredients' });
    if (actives.length) return mkTile({ status: 'available', source: 'deterministic', confidence: 'medium', value: actives });
    if (isFoodOrSupplement) {
      return mkTile({ status: 'unavailable', source: 'deterministic', reason: 'not_applicable_cosmetic_actives' });
    }
    return mkTile({ status: 'unavailable', source: 'deterministic', reason: 'missing_ingredients' });
  })();

  const formulationTile = (() => {
    if (!hasIngredients) return mkTile({ status: 'unavailable', source: 'none', reason: 'missing_ingredients' });
    if (isFoodOrSupplement) {
      return mkTile({
        status: 'available',
        source: 'deterministic',
        confidence: foodFormulation?.confidence || 'low',
        value: foodFormulation?.label || 'See ingredient list'
      });
    }
    return mkTile({
      status: 'available',
      source: 'deterministic',
      confidence: formulation?.confidence || 'low',
      value: formulation?.label || 'Unknown'
    });
  })();

  const functionTile = (() => {
    if (fn.length) return mkTile({ status: 'available', source: 'deterministic', confidence: 'medium', value: fn });
    if (!hasIngredients) {
      return mkTile({ status: 'unavailable', source: 'deterministic', reason: categoryRoute === 'unknown' ? 'category_unknown' : 'missing_ingredients' });
    }
    if (isFoodOrSupplement && noCosmeticActivesButHasText) {
      return mkTile({ status: 'unavailable', source: 'deterministic', reason: 'not_applicable_cosmetic_function' });
    }
    return mkTile({ status: 'unavailable', source: 'deterministic', reason: categoryRoute === 'unknown' ? 'category_unknown' : 'missing_ingredients' });
  })();

  const tiles = {
    key_actives: keyActivesTile,
    formulation: formulationTile,
    function: functionTile,
    skin_type: mkTile({ status: 'deferred', source: 'none', reason: 'no_profile_context' }),
    safety_score: mkTile({ status: 'deferred', source: 'none', reason: 'no_scoring_pipeline' })
  };
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    resolver_source: categoryRouteSource || null,
    route_rule_id: categoryRouteRuleId || null,
    catalog_source: catalogSource || null,
    tiles
  };
}

function buildResultSummary({
  scanSummary = null,
  hasProfileContext = false,
  routineConflicts = [],
  categoryRoute = 'unknown'
}) {
  const baseTiles = scanSummary?.tiles || buildScanSummary({ categoryRoute }).tiles;
  const functionTags = Array.isArray(baseTiles?.function?.value)
    ? baseTiles.function.value
    : [];
  const harmfulSeverity =
    routineConflicts.some((c) => String(c?.severity || '').toLowerCase() === 'high')
      ? 'high'
      : routineConflicts.length
        ? 'medium'
        : 'low';
  const goodAnswer = hasProfileContext ? (categoryRoute === 'unknown' ? 'unclear' : 'yes') : 'unknown';
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    disclaimer: 'informational_only',
    tiles: {
      ...baseTiles,
      skin_type: hasProfileContext
        ? mkTile({ status: 'available', source: 'graph', confidence: 'low', value: ['combination'] })
        : mkTile({ status: 'deferred', source: 'none', reason: 'no_profile_context' })
    },
    verdict: {
      product_overview: {
        status: 'available',
        source: 'deterministic',
        what_it_does: describeProductFunction(categoryRoute, functionTags)
      },
      good_for_me: {
        status: hasProfileContext ? 'available' : 'deferred',
        source: hasProfileContext ? 'graph' : 'none',
        confidence: hasProfileContext ? 'low' : null,
        answer: goodAnswer,
        summary: hasProfileContext ? 'Based on current session context.' : null,
        reason_unavailable: hasProfileContext ? null : 'no_profile_context'
      },
      harmful: {
        status: 'available',
        source: 'graph',
        confidence: routineConflicts.length ? 'medium' : 'low',
        severity: harmfulSeverity,
        flags: routineConflicts.slice(0, 3).map((c) => String(c?.id || 'routine_conflict')),
        top_evidence: routineConflicts[0]?.summary || 'No major routine conflict detected.',
        reason_unavailable: null
      },
      children_safe: {
        status: 'available',
        source: 'deterministic',
        confidence: harmfulSeverity === 'high' ? 'medium' : 'low',
        answer: harmfulSeverity === 'high' ? 'caution' : (categoryRoute === 'food' ? 'safe' : 'insufficient_data'),
        summary:
          harmfulSeverity === 'high'
            ? 'Potential irritant/conflict signals detected. Use caution for children.'
            : 'No strong child-safety signal from current deterministic checks.',
        reason_unavailable: null
      },
      /** No fabrication: stub until a vetted side-effect signal exists. */
      side_effects: {
        status: 'available',
        source: 'deterministic',
        summary: 'Not assessed in this scan.'
      },
      alternatives: buildDeterministicAlternatives({ categoryRoute, functionTags })
    },
    missing_more: [
      'Unlock personal-fit mode for age, sensitivity, and routine conflicts.',
      'Enable pediatric profile for stronger child-safety confidence.',
      'Compare against safer alternatives in one tap.'
    ]
  };
}

module.exports = {
  buildScanSummary,
  buildResultSummary
};
