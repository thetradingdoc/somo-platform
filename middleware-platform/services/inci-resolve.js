'use strict';

/**
 * services/inci-resolve.js
 *
 * Parse and resolve INCI ingredient text to canonical IDs.
 *
 * Resolution chain (fast → slow):
 *   1. exact    — COSING inci_name after normalise          confidence: 1
 *   2. alias    — ingredient_aliases → COSING               confidence: 0.95
 *   3. alias_unverified — alias hit but no COSING row       confidence: 0.6
 *   4. fuzzy    — Levenshtein ≤ threshold (see FUZZY_MAX_DIST) confidence: 0.75 / 0.65
 *   5. unresolved — no match                                confidence: 0.35
 *   noise       — sentinel tokens (+/-, may contain, etc.)  confidence: 0
 */

// ─── noise sentinel patterns ──────────────────────────────────────────────────
const NOISE_PATTERNS = [
  /^\+\/-$/,
  /^\+\/- ?$/i,
  /^may contain$/i,
  /^peut contenir$/i,
  /^\[?\+\/-\]?$/
];

function _isNoise(norm) {
  return NOISE_PATTERNS.some((re) => re.test(String(norm || '').trim()));
}

function _stripParenthetical(s) {
  return String(s || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function _norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const FUZZY_MAX_DIST = 2;
const FUZZY_MIN_TOKEN_LEN = 5;

function _levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[b.length][a.length];
}

/**
 * @param {string} tokenNorm
 * @param {string[]} candidates - normalised INCI names from COSING
 * @returns {{ match: string, dist: number } | null}
 */
function _fuzzyFind(tokenNorm, candidates) {
  if (tokenNorm.length < FUZZY_MIN_TOKEN_LEN) return null;
  let best = null;
  let bestDist = FUZZY_MAX_DIST + 1;
  for (const c of candidates) {
    if (Math.abs(c.length - tokenNorm.length) > FUZZY_MAX_DIST) continue;
    const d = _levenshtein(tokenNorm, c);
    if (d <= FUZZY_MAX_DIST && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best ? { match: best, dist: bestDist } : null;
}

/**
 * Split INCI / ingredients_text into ordered raw tokens.
 * Handles commas, semicolons, and newlines.
 *
 * @param {string} inciText
 * @returns {string[]}
 */
function parseInciText(inciText) {
  const raw = String(inciText || '');
  if (!raw.trim()) return [];
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {object} deps
 * @param {string[]} [deps.cosingCandidates] — normalised INCI names for fuzzy search
 */
function resolveInciToken(rawToken, deps) {
  const d = deps || {};
  const raw = String(rawToken || '').trim();
  const tokenNorm = _norm(raw);

  const getCosing =
    typeof d.getCosingIngredientByInci === 'function' ? d.getCosingIngredientByInci : () => null;
  const getAlias = typeof d.getAliasCanonical === 'function' ? d.getAliasCanonical : () => null;
  const candidates = Array.isArray(d.cosingCandidates) ? d.cosingCandidates : [];

  if (!tokenNorm) {
    return _result(raw, '', null, null, 'empty', 0);
  }

  if (_isNoise(tokenNorm)) {
    return _result(raw, tokenNorm, tokenNorm, null, 'noise', 0);
  }

  let direct = getCosing(tokenNorm);
  if (direct === undefined) direct = null;
  if (direct && direct.inci_name) {
    const key = _norm(direct.inci_name);
    return _result(raw, key, key, `cosing:${key}`, 'exact', 1);
  }

  const stripped = _stripParenthetical(tokenNorm);
  if (stripped && stripped !== tokenNorm) {
    let directStripped = getCosing(stripped);
    if (directStripped === undefined) directStripped = null;
    if (directStripped && directStripped.inci_name) {
      const key = _norm(directStripped.inci_name);
      return _result(raw, key, key, `cosing:${key}`, 'exact', 1);
    }
    let aliasStripped = getAlias(stripped);
    if (aliasStripped === undefined) aliasStripped = null;
    if (aliasStripped) {
      const canon = _norm(aliasStripped);
      let cosingViaAlias = getCosing(canon);
      if (cosingViaAlias === undefined) cosingViaAlias = null;
      if (cosingViaAlias && cosingViaAlias.inci_name) {
        const key = _norm(cosingViaAlias.inci_name);
        return _result(raw, key, key, `cosing:${key}`, 'alias', 0.95);
      }
      return _result(raw, canon, canon, `cosing:${canon}`, 'alias_unverified', 0.6);
    }
  }

  let viaAlias = getAlias(tokenNorm);
  if (viaAlias === undefined) viaAlias = null;
  if (viaAlias) {
    const canon = _norm(viaAlias);
    let cosingRow = getCosing(canon);
    if (cosingRow === undefined) cosingRow = null;
    if (cosingRow && cosingRow.inci_name) {
      const key = _norm(cosingRow.inci_name);
      return _result(raw, key, key, `cosing:${key}`, 'alias', 0.95);
    }
    return _result(raw, canon, canon, `cosing:${canon}`, 'alias_unverified', 0.6);
  }

  if (candidates.length > 0) {
    const fuzzy = _fuzzyFind(tokenNorm, candidates);
    if (fuzzy) {
      const key = fuzzy.match;
      const conf = fuzzy.dist === 1 ? 0.75 : 0.65;
      return _result(raw, key, key, `cosing:${key}`, 'fuzzy', conf);
    }
  }

  return _result(raw, tokenNorm, tokenNorm, null, 'unresolved', 0.35);
}

function _result(raw, inci_name, normalized_inci, ingredient_canonical_id, match_method, confidence) {
  return { raw, inci_name, normalized_inci, ingredient_canonical_id, match_method, confidence };
}

function resolveInciTextToRows(inciText, deps) {
  const tokens = parseInciText(inciText);
  return tokens.map((t, idx) => {
    const r = resolveInciToken(t, deps);
    return {
      inci_name: r.inci_name || _norm(t),
      ingredient_order: idx,
      raw_ingredient: r.raw,
      normalized_inci: r.normalized_inci,
      ingredient_role: null,
      confidence: r.confidence,
      ingredient_canonical_id: r.ingredient_canonical_id,
      match_method: r.match_method
    };
  });
}

module.exports = {
  parseInciText,
  resolveInciToken,
  resolveInciTextToRows,
  _levenshtein,
  _stripParenthetical,
  _isNoise
};
