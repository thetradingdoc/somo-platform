'use strict';

const { evaluateIngredientSafety } = require('./ingredient-ontology-resolver');

function resolveIngredientRisks({ ingredientFacts, conditions, secondarySignals }) {
  return evaluateIngredientSafety({ ingredientFacts, conditions, secondarySignals });
}

module.exports = { resolveIngredientRisks };
