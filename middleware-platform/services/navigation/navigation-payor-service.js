'use strict';

const { resolvePayor } = require('../payor-registry-resolver-service');
const { METRO_ENTITY_ID, METRO_PAYER_ID } = require('../../scripts/lib/navigation-demo-config.cjs');

function resolvePatientPlan({ plan_name, payer_id, state_hint } = {}) {
  const result = resolvePayor({
    payerText: plan_name,
    payerId: payer_id,
    stateHint: state_hint || 'NY'
  });

  if (!result.resolved) {
    return {
      success: false,
      error: 'plan_not_found',
      message: 'I could not match that health plan. Try saying Metro Health Plus.'
    };
  }

  const entity = result.canonical_entity;
  return {
    success: true,
    payor_entity_id: entity.id,
    payer_id: result.routing.payer_id || entity.canonical_payer_id,
    plan_display_name: entity.canonical_name,
    resolution_source: result.resolution_source,
    state_scope: entity.state_scope || state_hint || 'NY',
    demo_default: entity.id === METRO_ENTITY_ID && (result.routing.payer_id || entity.canonical_payer_id) === METRO_PAYER_ID
  };
}

module.exports = { resolvePatientPlan };
