const fs = require('fs');
const path = require('path');

const TAX_PATH = path.resolve(__dirname, '../taxonomy/baumann-skin-map.v1.json');
let _tax = null;
function loadTax() {
  if (_tax) return _tax;
  _tax = JSON.parse(fs.readFileSync(TAX_PATH, 'utf8'));
  return _tax;
}

function _asBand(maxScore, thresholds) {
  const high = Number(thresholds?.high || 0.75);
  const medium = Number(thresholds?.medium || 0.5);
  if (maxScore >= high) return 'high';
  if (maxScore >= medium) return 'medium';
  return 'low';
}

function _choose(scores, a, b) {
  return scores[a] >= scores[b] ? a : b;
}

function resolveBaumannCode({ skinType, secondarySignals }) {
  const tax = loadTax();
  const st = String(skinType || '').toLowerCase();
  const sec = secondarySignals || {};
  const scores = { O: 0, D: 0, S: 0, R: 0, P: 0, N: 0, W: 0, T: 0 };
  const evidence = [];
  const dims = tax.dimensions || {};

  const applyMap = (map, sourceKey) => {
    if (!map) return;
    for (const [k, v] of Object.entries(map)) {
      scores[k] = (scores[k] || 0) + Number(v || 0);
      evidence.push({ source: sourceKey, label: k, weight: Number(v || 0) });
    }
  };

  applyMap(dims?.sebum?.signals?.from_skin_type?.[st], 'skin_type');
  applyMap(dims?.sensitivity?.signals?.from_skin_type?.[st], 'skin_type');

  if (sec.is_dehydrated) applyMap(dims?.sebum?.signals?.from_secondary_signals?.is_dehydrated, 'secondary:is_dehydrated');
  if (sec.oily_finish) applyMap(dims?.sebum?.signals?.from_secondary_signals?.oily_finish, 'secondary:oily_finish');
  if (sec.is_inflamed) applyMap(dims?.sensitivity?.signals?.from_secondary_signals?.is_inflamed, 'secondary:is_inflamed');
  if (sec.active_flare) applyMap(dims?.sensitivity?.signals?.from_secondary_signals?.active_flare, 'secondary:active_flare');

  const risk = String(sec.pigment_risk || 'low').toLowerCase();
  applyMap(dims?.pigmentation?.signals?.from_secondary_signals?.[`pigment_risk:${risk}`], `secondary:pigment_risk:${risk}`);
  const photo = String(sec.phototype_hint || '').toLowerCase();
  if (photo) applyMap(dims?.pigmentation?.signals?.from_secondary_signals?.[`phototype_hint:${photo}`], `secondary:phototype_hint:${photo}`);

  if (sec.is_dehydrated) applyMap(dims?.aging?.signals?.from_secondary_signals?.is_dehydrated, 'secondary:is_dehydrated');
  if (sec.barrier_compromised) applyMap(dims?.aging?.signals?.from_secondary_signals?.barrier_compromised, 'secondary:barrier_compromised');

  // Default neutral support so code remains deterministic even with sparse signals.
  scores.R += 0.1;
  scores.N += 0.1;
  scores.T += 0.1;

  const code = `${_choose(scores, 'O', 'D')}${_choose(scores, 'S', 'R')}${_choose(scores, 'P', 'N')}${_choose(scores, 'W', 'T')}`;
  const maxLabelScore = Math.max(scores.O, scores.D, scores.S, scores.R, scores.P, scores.N, scores.W, scores.T);

  return {
    code,
    confidence: _asBand(maxLabelScore, tax.confidence_thresholds),
    resolver_version: tax.resolver_version || 'baumann-v1',
    dimension_scores: {
      sebum: { O: scores.O, D: scores.D },
      sensitivity: { S: scores.S, R: scores.R },
      pigmentation: { P: scores.P, N: scores.N },
      aging: { W: scores.W, T: scores.T }
    },
    evidence
  };
}

module.exports = { resolveBaumannCode };
