const fs = require('fs');
const path = require('path');

const ONTOLOGY_PATH = path.resolve(__dirname, '../taxonomy/conflict-ontology.v1.json');
let _ontology = null;

function loadOntology() {
  if (_ontology) return _ontology;
  _ontology = JSON.parse(fs.readFileSync(ONTOLOGY_PATH, 'utf8'));
  return _ontology;
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\w\s/-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolveSkinConflicts({ message, conditions, ingredientFacts }) {
  const text = normalize(message);
  const condSet = new Set((Array.isArray(conditions) ? conditions : []).map((c) => String(c.id || c).toLowerCase()));
  const ingNameSet = new Set((Array.isArray(ingredientFacts) ? ingredientFacts : []).map((x) => String(x.name || '').toLowerCase()));
  const roleSet = new Set(
    (Array.isArray(ingredientFacts) ? ingredientFacts : [])
      .flatMap((x) => Array.isArray(x.roles) ? x.roles : [])
      .map((r) => String(r).toLowerCase())
  );
  const out = [];
  const ontology = loadOntology();
  for (const rule of ontology.conflicts || []) {
    const reqConds = (rule.when?.conditions_any || []).map((x) => String(x).toLowerCase());
    const reqIngredients = (rule.when?.ingredients_any || []).map((x) => String(x).toLowerCase());
    const condMatch = reqConds.some((c) => condSet.has(c));
    const ingMatch = reqIngredients.some((i) => text.includes(i) || ingNameSet.has(i) || roleSet.has(i));
    if (condMatch && ingMatch) {
      out.push({
        id: rule.id,
        severity: rule.severity || 'low',
        next_action: rule.next_action || 'Ask one clarifying follow-up.'
      });
    }
  }
  return out;
}

module.exports = { resolveSkinConflicts };
