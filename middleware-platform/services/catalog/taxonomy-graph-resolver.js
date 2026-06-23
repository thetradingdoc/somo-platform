function normalizeSet(values) {
  return new Set((Array.isArray(values) ? values : []).map((v) => String(v || '').toLowerCase()).filter(Boolean));
}

function resolveTaxonomyGraphAction({ db, conditions, ingredientFacts, secondarySignals, rulesOverride }) {
  let rules = Array.isArray(rulesOverride) ? rulesOverride : null;
  if (!rules) {
    if (!db || !db.prepare) return null;
    try {
      rules = db.prepare(`
        SELECT id, when_json, then_json
        FROM taxonomy_rules
        WHERE module = 'skin_graph' AND active = 1
        ORDER BY priority ASC, created_at ASC
      `).all();
    } catch (_) {
      return null;
    }
  }
  const condSet = normalizeSet((conditions || []).map((c) => c.id || c));
  const ingredients = normalizeSet((ingredientFacts || []).flatMap((i) => [i.name].concat(i.roles || [])));
  const pigmentRisk = String(secondarySignals?.pigment_risk || '').toLowerCase();

  for (const row of rules) {
    let when = {};
    let then = {};
    try { when = JSON.parse(String(row.when_json || '{}')); } catch (_) {}
    try { then = JSON.parse(String(row.then_json || '{}')); } catch (_) {}
    const condMatch = !Array.isArray(when.conditions_any) || when.conditions_any.some((c) => condSet.has(String(c).toLowerCase()));
    const ingMatch = !Array.isArray(when.ingredients_any) || when.ingredients_any.some((i) => ingredients.has(String(i).toLowerCase()));
    const pigmentMatch = !Array.isArray(when.pigment_risk_any) || when.pigment_risk_any.includes(pigmentRisk);
    if (condMatch && ingMatch && pigmentMatch) {
      return {
        rule_id: row.id,
        clarify_required: !!then.clarify_required,
        blocked: !!then.blocked,
        next_question: String(then.next_question || 'Let me ask one clarifying question so we keep this safe.'),
        allowed: !then.blocked
      };
    }
  }
  return null;
}

module.exports = { resolveTaxonomyGraphAction };
