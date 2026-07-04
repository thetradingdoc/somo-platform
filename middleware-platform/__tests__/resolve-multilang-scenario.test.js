'use strict';

const { getScenarioById } = require('../e2e/scenario-registry/dental-front-desk.cjs');
const { resolveMultilangScenario } = require('../scripts/kelly-multilang-conversation-eval.cjs');

describe('resolveMultilangScenario', () => {
  test('EN-3-copay-preinquiry does not inherit copayPayment from DENTAL-003', () => {
    const raw = getScenarioById('EN-3-copay-preinquiry');
    const resolved = resolveMultilangScenario(raw);
    expect(resolved.evalTags).toContain('copay_eligibility');
    expect(resolved.copayPayment).toBe(false);
  });

  test('EN-3-payment keeps copayPayment true', () => {
    const raw = getScenarioById('EN-3-payment');
    const resolved = resolveMultilangScenario(raw);
    expect(resolved.evalTags).toContain('copay_payment');
    expect(resolved.copayPayment).toBe(true);
  });
});
