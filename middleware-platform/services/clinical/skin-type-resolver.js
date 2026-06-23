const fs = require('fs');
const path = require('path');

const TAXONOMY_PATH = path.resolve(__dirname, '../taxonomy/skin-type.v1.json');
const RESOLVER_VERSION = 'skin_type_resolver.v1';

let _taxonomy = null;
let _aliasIndex = null;

function loadTaxonomy() {
  if (_taxonomy) return _taxonomy;
  const raw = fs.readFileSync(TAXONOMY_PATH, 'utf8');
  _taxonomy = JSON.parse(raw);
  return _taxonomy;
}

function buildAliasIndex() {
  if (_aliasIndex) return _aliasIndex;
  const taxonomy = loadTaxonomy();
  const idx = new Map();
  for (const cls of taxonomy.classes || []) {
    for (const alias of cls.aliases || []) {
      idx.set(String(alias || '').toLowerCase(), cls.id);
    }
  }
  _aliasIndex = idx;
  return _aliasIndex;
}

function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/[^\w\s/-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isNegated(text, phrase, negationTerms) {
  const t = String(text || '');
  const p = String(phrase || '');
  if (!t || !p) return false;
  const i = t.indexOf(p);
  if (i < 0) return false;
  const before = t.slice(Math.max(0, i - 30), i);
  const n = (negationTerms || []).join('|');
  return new RegExp(`\\b(${n})\\b\\s+(?:\\w+\\s+){0,3}$`).test(before);
}

function confidenceBand(score, thresholds) {
  if (score >= Number(thresholds?.high || 0.85)) return 'high';
  if (score >= Number(thresholds?.medium || 0.6)) return 'medium';
  return 'low';
}

function explicitTypeSignals(text) {
  const t = String(text || '').toLowerCase();
  return {
    oily: /\b(i am|i'm|my skin is|skin is)\s+oily\b|\boily skin\b/.test(t),
    dry: /\b(i am|i'm|my skin is|skin is)\s+dry\b|\bdry skin\b/.test(t),
    combination: /\bcombination skin\b|\bcombo skin\b/.test(t),
    sensitive: /\bsensitive skin\b|\breactive skin\b/.test(t),
    normal: /\bnormal skin\b|\bbalanced skin\b/.test(t),
    tightOnly: /\btight\b/.test(t) && !/\bdry\b/.test(t)
  };
}

function resolveSkinType({ text, turnSeq = 1, previous = null }) {
  const taxonomy = loadTaxonomy();
  const aliasIndex = buildAliasIndex();
  const normalized = normalizeText(text);
  const negationTerms = taxonomy.negation_terms || [];

  const scores = {};
  const evidence = [];
  const explicit = explicitTypeSignals(normalized);
  for (const cls of taxonomy.classes || []) scores[cls.id] = 0;

  if (explicit.oily) scores.oily += 1.1;
  if (explicit.dry) scores.dry += 1.1;
  if (explicit.combination) scores.combination += 1.1;
  if (explicit.sensitive) scores.sensitive += 1.1;
  if (explicit.normal) scores.normal += 1.1;
  if (explicit.tightOnly) {
    // "tight" alone is typically a condition cue; keep dry influence weak.
    scores.dry += 0.15;
    evidence.push({ source: 'text', turn_seq: Number(turnSeq) || 1, span: 'tight', signal: 'condition_like_tight', weight: 0.15 });
  }

  for (const [alias, clsId] of aliasIndex.entries()) {
    if (normalized.includes(alias)) {
      if (clsId === 'dry' && alias === 'tight skin' && explicit.oily) continue;
      const negated = isNegated(normalized, alias, negationTerms);
      const w = negated ? -0.45 : 0.55;
      scores[clsId] = (scores[clsId] || 0) + w;
      evidence.push({
        source: 'text',
        turn_seq: Number(turnSeq) || 1,
        span: alias,
        signal: negated ? 'alias_negated' : 'alias_match',
        weight: w
      });
    }
  }

  for (const cls of taxonomy.classes || []) {
    for (const sig of cls.positive_signals || []) {
      const pat = String(sig.pattern || '').toLowerCase();
      if (!pat || !normalized.includes(pat)) continue;
      if (cls.id === 'dry' && pat === 'tight after washing' && explicit.oily) continue;
      const negated = isNegated(normalized, pat, negationTerms);
      if (negated) continue;
      const w = Number(sig.weight || 0);
      scores[cls.id] = (scores[cls.id] || 0) + w;
      evidence.push({ source: 'text', turn_seq: Number(turnSeq) || 1, span: pat, signal: 'positive_signal', weight: w });
    }
    for (const sig of cls.negative_signals || []) {
      const pat = String(sig.pattern || '').toLowerCase();
      if (!pat || !normalized.includes(pat)) continue;
      const w = Number(sig.weight || 0);
      scores[cls.id] = (scores[cls.id] || 0) + w;
      evidence.push({ source: 'text', turn_seq: Number(turnSeq) || 1, span: pat, signal: 'negative_signal', weight: w });
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topId, topScoreRaw] = sorted[0] || ['unknown', 0];
  const [, secondScoreRaw] = sorted[1] || ['unknown', 0];
  const topScore = Number(topScoreRaw || 0);
  const secondScore = Number(secondScoreRaw || 0);

  const tieDelta = Number(taxonomy.tie_break_delta || 0.12);
  const tied = topScore <= 0 || Math.abs(topScore - secondScore) < tieDelta;
  const value = tied ? 'unknown' : topId;
  const confidence = tied ? 'low' : confidenceBand(topScore, taxonomy.confidence_thresholds);

  let status = confidence === 'high' ? 'confirmed' : 'tentative';
  if (previous && previous.value && previous.value !== value && value !== 'unknown') status = 'corrected';

  return {
    taxonomy_module: 'skin_type',
    resolver_version: RESOLVER_VERSION,
    value,
    status,
    confidence,
    evidence,
    needs_confirmation: value === 'unknown' || confidence !== 'high',
    version: 1,
    score_debug: sorted.slice(0, 3).map(([id, score]) => ({ id, score }))
  };
}

module.exports = {
  resolveSkinType,
  RESOLVER_VERSION
};
