const fs = require('fs');
const path = require('path');

const TAX_PATH = path.resolve(__dirname, '../taxonomy/ingredient-taxonomy.v1.json');
let _tax = null;
function load() {
  if (_tax) return _tax;
  _tax = JSON.parse(fs.readFileSync(TAX_PATH, 'utf8'));
  return _tax;
}

function normalizeIngredientName(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return '';
  const map = {
    'ha': 'hyaluronic acid',
    'sodium hyaluronate': 'hyaluronic acid',
    'retinoid': 'retinol',
    'beta hydroxy acid': 'salicylic acid',
    'alpha hydroxy acid': 'glycolic acid'
  };
  return map[n] || n;
}

function resolveIngredientFacts(text) {
  const t = String(text || '').toLowerCase();
  const hits = [];
  for (const ing of (load().ingredients || [])) {
    const names = [ing.name].concat(Array.isArray(ing.aliases) ? ing.aliases : []);
    if (names.some((n) => t.includes(String(n).toLowerCase()))) hits.push(ing);
  }
  return hits;
}

function evaluateIngredientSafety({ ingredientFacts, conditions, secondarySignals }) {
  const condSet = new Set((Array.isArray(conditions) ? conditions : []).map((c) => String(c.id || c).toLowerCase()));
  const sec = secondarySignals || {};
  const alerts = [];
  for (const ing of (ingredientFacts || [])) {
    const reasons = [];
    if (Array.isArray(ing.contraindications)) {
      for (const c of ing.contraindications) if (condSet.has(String(c).toLowerCase())) reasons.push(`contraindicated_for:${c}`);
    }
    if (String(sec.pigment_risk || '').toLowerCase() === 'high' && String(ing.photosensitivity_risk || 'low') === 'high') {
      reasons.push('high_pigment_risk_with_photosensitive_active');
    }
    if (reasons.length > 0) {
      alerts.push({
        ingredient: ing.name,
        severity: String(ing.interaction_strength || 'low'),
        why: reasons,
        safe_next_action: 'Use conservative cadence and prioritize barrier support until tolerance is clear.',
        contraindicated_for: Array.from(condSet)
      });
    }
  }
  return alerts;
}

function enrichBiochemFacts(ingredientFacts) {
  return (ingredientFacts || []).map((ing) => {
    const canonical = normalizeIngredientName(ing.name);
    const pathways = [];
    if (/retinol|retinoid|tretinoin|retinal/.test(canonical)) pathways.push('keratinocyte_turnover');
    if (/glycolic acid/.test(canonical)) pathways.push('desquamation');
    if (/salicylic acid/.test(canonical)) pathways.push('comedolysis');
    if (/hyaluronic acid/.test(canonical)) pathways.push('water_binding');
    return {
      inci_name: canonical,
      derivative_of: canonical === 'hyaluronic acid' ? 'glycosaminoglycan' : null,
      molecular_class: canonical.includes('acid') ? 'acid' : 'other',
      pathways,
      evidence_level: 'medium'
    };
  });
}

module.exports = { resolveIngredientFacts, evaluateIngredientSafety, normalizeIngredientName, enrichBiochemFacts };
