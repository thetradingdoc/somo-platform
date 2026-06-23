'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAP_PATH = path.resolve(__dirname, '../taxonomy/category-route-map.v1.json');
const DEFAULT_ALIAS_PATH = path.resolve(__dirname, '../taxonomy/category-route-aliases.v1.json');
const DEFAULT_SUPPRESS_PATH = path.resolve(__dirname, '../taxonomy/category-route-suppression.v1.json');
const cacheByPath = new Map();

function resolveMapPath(mapFile) {
  const explicit = String(mapFile || '').trim();
  if (explicit) return path.resolve(__dirname, '..', explicit);
  const fromEnv = String(process.env.CATEGORY_ROUTE_MAP_FILE || '').trim();
  if (fromEnv) return path.resolve(__dirname, '..', fromEnv);
  return DEFAULT_MAP_PATH;
}

function loadMap(mapFile = null) {
  const mapPath = resolveMapPath(mapFile);
  if (cacheByPath.has(mapPath)) return cacheByPath.get(mapPath);
  const loaded = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  cacheByPath.set(mapPath, loaded);
  return loaded;
}

function loadJsonFile(filePath) {
  if (cacheByPath.has(filePath)) return cacheByPath.get(filePath);
  const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  cacheByPath.set(filePath, loaded);
  return loaded;
}

function loadAliases() {
  return loadJsonFile(DEFAULT_ALIAS_PATH);
}

function loadSuppression() {
  return loadJsonFile(DEFAULT_SUPPRESS_PATH);
}

function normalizeTag(tag) {
  return String(tag || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const aliases = loadAliases()?.aliases || {};
  const suppressed = new Set(loadSuppression()?.suppressed_tags || []);
  const out = [];
  for (const t0 of tags) {
    const t = normalizeTag(t0);
    if (!t) continue;
    const canonical = normalizeTag(aliases[t] || t);
    if (!canonical) continue;
    if (suppressed.has(canonical)) continue;
    out.push(canonical);
  }
  return [...new Set(out)];
}

function routeFromMap(tags, map) {
  const matches = [];
  for (const t of tags) {
    const route = map.tag_to_route[t];
    if (route) matches.push({ tag: t, route });
  }
  return matches;
}

function chooseByPrecedence(matches, map) {
  if (!Array.isArray(matches) || !matches.length) return null;
  const precedence = Array.isArray(map.precedence) ? map.precedence : [];
  let best = matches[0];
  let bestRank = precedence.indexOf(best.route);
  if (bestRank < 0) bestRank = Number.MAX_SAFE_INTEGER;
  for (const m of matches.slice(1)) {
    let r = precedence.indexOf(m.route);
    if (r < 0) r = Number.MAX_SAFE_INTEGER;
    if (r < bestRank) {
      best = m;
      bestRank = r;
    }
  }
  return best;
}

function resolveCategoryRoute(options = {}) {
  const map = loadMap(options.mapFile || null);
  const tags = normalizeTags(options.categories_tags || []);
  const hierarchy = normalizeTags(options.categories_hierarchy || []);
  const source = String(options.source || '').trim().toLowerCase() || null;
  const productName = String(options.product_name || '').trim();
  const brands = Array.isArray(options.brands) ? options.brands : [];
  const ingredientsText = String(options.ingredients_text || '').trim();

  const tagMatches = routeFromMap(tags, map);
  const hierarchyMatches = routeFromMap(hierarchy, map);
  const allMatches = [...tagMatches, ...hierarchyMatches];
  const picked = chooseByPrecedence(allMatches, map);
  const distinctRoutes = [...new Set(allMatches.map((m) => m.route))];
  const conflict = distinctRoutes.length > 1;

  const fallbackCopy = map?.heuristics?.low_confidence_policy?.fallback_copy || {};

  const strongMapMatch = !!picked && !conflict;
  const heuristic = resolveHeuristicRoute({ productName, brands, ingredientsText, map });
  // Map precedence is authoritative whenever any deterministic map match exists.
  // Heuristics are only a fallback when no map match is present.
  const shouldUseHeuristic = !picked && !!heuristic;

  if (!picked && !heuristic) {
    return {
      route: 'unknown',
      source: 'taxonomy_map',
      map_version: map.version,
      confidence_band: 'low',
      matched_tag: null,
      conflict: false,
      rule_id: 'no_matching_tag',
      change_reason: 'no_matching_tag',
      review_eligible: true,
      fallback_text: fallbackCopy.unknown || null
    };
  }

  const confidence = conflict ? 'medium' : 'high';
  const changeReason = conflict
    ? `conflict_resolved_by_precedence:${source || 'unknown_source'}`
    : 'single_route_match';

  if (shouldUseHeuristic && heuristic) {
    return {
      route: heuristic.route,
      source: 'heuristic',
      map_version: map.version,
      confidence_band: heuristic.confidence_band,
      matched_tag: null,
      conflict: false,
      rule_id: heuristic.rule_id,
      change_reason: `heuristic:${heuristic.rule_id}`,
      review_eligible: heuristic.confidence_band === 'low',
      fallback_text: heuristic.confidence_band === 'low' ? (fallbackCopy.low_confidence || null) : null
    };
  }

  return {
    route: picked.route,
    source: 'taxonomy_map',
    map_version: map.version,
    confidence_band: confidence,
    matched_tag: picked.tag,
    conflict,
    rule_id: conflict ? 'map_conflict_precedence' : 'map_exact_match',
    change_reason: changeReason,
    review_eligible: false,
    fallback_text: null
  };
}

function parseTopIngredients(ingredientsText, n = 3) {
  return String(ingredientsText || '')
    .toLowerCase()
    .split(/[,\.;]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, n);
}

function regexMatch(pattern, text) {
  try {
    return new RegExp(pattern, 'i').test(text);
  } catch (_) {
    return false;
  }
}

function resolveHeuristicRoute({ productName, brands, ingredientsText, map }) {
  const heuristics = map?.heuristics || {};
  const negative = heuristics.negative_signals || {};
  const positive = heuristics.positive_signals || {};
  const titleBlob = [productName, ...brands].join(' ').trim();
  const ingredientsBlob = String(ingredientsText || '');

  const topN = Number(negative.top_ingredients_n || 3);
  const topIngredients = parseTopIngredients(ingredientsBlob, topN);
  const strong = Array.isArray(negative.strong_food_tokens) ? negative.strong_food_tokens : [];
  const weak = Array.isArray(negative.weak_food_tokens) ? negative.weak_food_tokens : [];
  const weakReq = Number(negative.requires_weak_token_count || 2);
  const strongHit = topIngredients.some((i) => strong.some((t) => i.includes(t)));
  const weakHits = topIngredients.reduce(
    (n, i) => n + (weak.some((t) => i.includes(t)) ? 1 : 0),
    0
  );
  if (strongHit || weakHits >= weakReq) {
    return { route: 'food', rule_id: strongHit ? 'neg_food_strong' : 'neg_food_combo', confidence_band: 'medium' };
  }

  for (const r of positive.title_or_brand || []) {
    if (regexMatch(r.pattern, titleBlob)) {
      return { route: r.route, rule_id: r.rule_id || 'title_pattern', confidence_band: 'medium' };
    }
  }
  for (const r of positive.regulatory_drug_adjacent || []) {
    if (regexMatch(r.pattern, `${titleBlob} ${ingredientsBlob}`)) {
      return { route: r.route, rule_id: r.rule_id || 'regulatory_pattern', confidence_band: 'medium' };
    }
  }
  for (const r of positive.ingredient_substrings || []) {
    if (regexMatch(r.pattern, ingredientsBlob)) {
      return { route: r.route, rule_id: r.rule_id || 'ingredient_pattern', confidence_band: 'low' };
    }
  }
  return null;
}

module.exports = {
  resolveCategoryRoute,
  normalizeTags,
  normalizeTag,
  parseTopIngredients,
  loadMap,
  loadAliases,
  loadSuppression
};
