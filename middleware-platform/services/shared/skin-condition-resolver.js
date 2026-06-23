const fs = require('fs');
const path = require('path');
const { resolveSensationSignals } = require('../platform/sensation-ontology-resolver');

const TAXONOMY_PATH = path.resolve(__dirname, '../taxonomy/skin-condition.v1.json');
const RESOLVER_VERSION = 'skin_condition_resolver.v1';

let _taxonomy = null;

function loadTaxonomy() {
  if (_taxonomy) return _taxonomy;
  _taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
  return _taxonomy;
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\w\s/-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function band(score) {
  if (score >= 0.85) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}

function resolveSkinConditions({ text, skinType = '', visionHint = '' }) {
  const t = normalize(text);
  const sensationSignals = resolveSensationSignals(t);
  const taxonomy = loadTaxonomy();
  const out = [];
  const reasonCodes = [];
  for (const cond of taxonomy.conditions || []) {
    let score = 0;
    for (const a of cond.aliases || []) {
      if (t.includes(String(a).toLowerCase())) score += 0.35;
    }
    for (const s of cond.signals || []) {
      const p = String(s.pattern || '').toLowerCase();
      if (p && t.includes(p)) {
        score += Number(s.weight || 0);
        reasonCodes.push(`cond:${cond.id}:signal:${p}`);
      }
    }
    if (cond.id === 'dehydrated' && String(skinType || '').toLowerCase() === 'oily' && /\btight|flaky|dehydrated\b/.test(t)) {
      score += 0.4; // oily + tight coexistence boost
      reasonCodes.push('coexist:oily_plus_dehydrated');
    }
    if (cond.id === 'dehydrated' && sensationSignals.some((s) => s.signal === 'signal_surface_dehydration')) {
      score += 0.6;
      reasonCodes.push('sensation:surface_dehydration');
    }
    if (cond.id === 'inflamed' && sensationSignals.some((s) => s.signal === 'signal_inflammation')) {
      score += 0.6;
      reasonCodes.push('sensation:inflammation');
    }
    if (score > 0) {
      out.push({
        id: cond.id,
        confidence: band(score),
        score,
        safe_next_action: cond.safe_next_action
      });
    }
  }
  return {
    taxonomy_module: 'skin_condition',
    resolver_version: RESOLVER_VERSION,
    conditions: out.sort((a, b) => b.score - a.score),
    secondary_signals: {
      is_dehydrated: out.some((c) => c.id === 'dehydrated'),
      is_inflamed: out.some((c) => c.id === 'inflamed'),
      pigment_risk: /hyperpigmentation|dark spots|pih/.test(t) ? 'high' : 'low',
      phototype_hint: ['I', 'II', 'III', 'IV', 'V', 'VI'].includes(String(visionHint || '')) ? String(visionHint) : null
    },
    reason_codes: reasonCodes
  };
}

module.exports = { resolveSkinConditions, RESOLVER_VERSION };
