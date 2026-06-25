'use strict';

const { resolvePatientPlan } = require('../services/navigation/navigation-payor-service');
const { checkPlanBenefits } = require('../services/navigation/navigation-benefits-service');
const { METRO_ENTITY_ID } = require('../scripts/lib/navigation-demo-config.cjs');
const { seedMetroHealthPlus } = require('../scripts/seed-navigation-demo.cjs');

describe('navigation-payor-service', () => {
  beforeAll(() => {
    seedMetroHealthPlus();
  });
  test('resolves Metro Health Plus alias', () => {
    const r = resolvePatientPlan({ plan_name: 'Metro Health Plus', state_hint: 'NY' });
    expect(r.success).toBe(true);
    expect(r.payor_entity_id).toBe(METRO_ENTITY_ID);
    expect(r.payer_id).toBe('METRO-HEALTH-PLUS');
  });

  test('rejects unknown plan', () => {
    const r = resolvePatientPlan({ plan_name: 'Unknown Carrier XYZ' });
    expect(r.success).toBe(false);
  });
});

describe('navigation-benefits-service', () => {
  test('returns five benefit summaries when no specialty_key', () => {
    const r = checkPlanBenefits({ payor_entity_id: METRO_ENTITY_ID, zip: '10001' });
    expect(r.success).toBe(true);
    expect(r.benefits.length).toBe(5);
  });
});
