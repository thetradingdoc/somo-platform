'use strict';

const {
  buildLandingRouteIntentPlan,
  selectPolicyPack
} = require('../services/landing-route-intent-planner');

describe('landing-route-intent-planner', () => {
  test('plans food scan turns with clarifier bypass', () => {
    const plan = buildLandingRouteIntentPlan({
      message: 'For this scanned product, what does low risk mean for children?',
      shortTermThread: [
        {
          type: 'barcode_product_context',
          text: '[Barcode Scan] Product context pinned',
          product_data: { category_route: 'food' }
        }
      ]
    });

    expect(plan.route_context.route).toBe('food');
    expect(plan.intent_context.intent).toBe('scan_question');
    expect(plan.policy_pack).toBe('food_scan_policy');
    expect(plan.flags.should_bypass_skincare_clarifier).toBe(true);
  });

  test('uses mixed-intent arbitration for scan + triage asks', () => {
    const plan = buildLandingRouteIntentPlan({
      message: 'I scanned this supplement and now I have a rash, what should I do?',
      shortTermThread: [
        { type: 'barcode_product_context', text: '[Barcode Scan]', product_data: { category_route: 'supplement' } }
      ]
    });

    expect(plan.route_context.route).toBe('supplement');
    expect(plan.intent_context.intent).toBe('mixed_scan_triage');
    expect(plan.arbitration.mixed_intent).toBe(true);
    expect(plan.policy_pack).toBe('scan_route_priority_with_triage_safety');
  });

  test('selectPolicyPack maps unknown route scan intent to unknown_scan_policy', () => {
    expect(selectPolicyPack('unknown', 'scan_question')).toBe('unknown_scan_policy');
  });

  test('keeps routine policy for cosmetic routine asks', () => {
    const plan = buildLandingRouteIntentPlan({
      message: 'My skin is dry, should I add a moisturizer to my routine?',
      shortTermThread: [
        { type: 'barcode_product_context', text: '[Barcode Scan]', product_data: { category_route: 'cosmetic' } }
      ]
    });

    expect(plan.route_context.route).toBe('cosmetic');
    expect(plan.intent_context.intent).toBe('routine_question');
    expect(plan.policy_pack).toBe('routine_policy');
    expect(plan.flags.should_bypass_skincare_clarifier).toBe(false);
  });
});
