'use strict';

const LIVE_SEMANTIC_CONTRACT_VERSION = '1';

const BASE = {
  semantic_contract_version: LIVE_SEMANTIC_CONTRACT_VERSION,
  fallback_policy: 'catalog_context',
  valid_fields: [
    'tiles.skin_type',
    'verdict.product_overview',
    'verdict.good_for_me',
    'verdict.harmful',
    'verdict.children_safe',
    'verdict.side_effects'
  ],
  forbidden_vocab: [],
  verdict_framing: 'catalog_context'
};

const REGISTRY = {
  cosmetic: {
    ...BASE,
    route: 'cosmetic',
    verdict_framing: 'cosmetic',
    valid_fields: [...BASE.valid_fields, 'verdict.alternatives', 'tiles.key_actives', 'tiles.function', 'tiles.formulation']
  },
  hygiene: {
    ...BASE,
    route: 'hygiene',
    verdict_framing: 'cosmetic',
    valid_fields: [...BASE.valid_fields, 'verdict.alternatives', 'tiles.key_actives', 'tiles.function', 'tiles.formulation']
  },
  food: {
    ...BASE,
    route: 'food',
    valid_fields: [...BASE.valid_fields, 'verdict.alternatives.footer', 'tiles.formulation'],
    forbidden_vocab: [
      'tone_evening',
      'anti_aging',
      'barrier_support',
      'blemish_control',
      'oil_balance',
      'active acid formulas',
      'retinoid activity'
    ]
  },
  supplement: {
    ...BASE,
    route: 'supplement',
    valid_fields: [...BASE.valid_fields, 'verdict.alternatives.footer', 'tiles.formulation'],
    forbidden_vocab: [
      'tone_evening',
      'anti_aging',
      'barrier_support',
      'blemish_control',
      'oil_balance',
      'active acid formulas',
      'retinoid activity'
    ]
  },
  meds: {
    ...BASE,
    route: 'meds',
    valid_fields: [...BASE.valid_fields, 'verdict.alternatives.footer', 'tiles.formulation'],
    forbidden_vocab: [
      'tone_evening',
      'anti_aging',
      'barrier_support',
      'blemish_control',
      'oil_balance',
      'active acid formulas',
      'retinoid activity'
    ]
  },
  non_food: {
    ...BASE,
    route: 'non_food',
    valid_fields: [...BASE.valid_fields, 'verdict.alternatives.footer', 'tiles.formulation'],
    forbidden_vocab: [
      'tone_evening',
      'anti_aging',
      'barrier_support',
      'blemish_control',
      'oil_balance',
      'active acid formulas',
      'retinoid activity'
    ]
  },
  unknown: {
    ...BASE,
    route: 'unknown',
    valid_fields: [...BASE.valid_fields, 'verdict.alternatives.footer', 'tiles.formulation'],
    forbidden_vocab: ['tone_evening', 'anti_aging', 'barrier_support', 'blemish_control', 'oil_balance']
  }
};

function getLiveSemanticContractVersion() {
  return LIVE_SEMANTIC_CONTRACT_VERSION;
}

function normalizeRoute(route) {
  const r = String(route || '').trim().toLowerCase();
  return REGISTRY[r] ? r : 'unknown';
}

function getSemanticContract(route) {
  const r = normalizeRoute(route);
  return JSON.parse(JSON.stringify(REGISTRY[r]));
}

function listSemanticContracts() {
  return JSON.parse(JSON.stringify(REGISTRY));
}

module.exports = {
  getLiveSemanticContractVersion,
  getSemanticContract,
  listSemanticContracts
};
