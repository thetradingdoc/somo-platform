'use strict';

const knowledgeService = require('../services/knowledge-service');

describe('E/M time guardrails (BL-04)', () => {
  test('99215 at 45 minutes stays 99215', () => {
    const routed = knowledgeService.routeEmByDuration('99215', 45);
    expect(routed.code).toBe('99215');
    expect(routed.downgraded).toBe(false);
  });

  test('99215 at 35 minutes downgrades to 99214', () => {
    const routed = knowledgeService.routeEmByDuration('99215', 35);
    expect(routed.code).toBe('99214');
    expect(routed.downgraded).toBe(true);
    expect(routed.original).toBe('99215');
  });

  test('99214 at 25 minutes downgrades to 99213', () => {
    const routed = knowledgeService.routeEmByDuration('99214', 25);
    expect(routed.code).toBe('99213');
    expect(routed.downgraded).toBe(true);
  });

  test('99214 at 32 minutes stays 99214', () => {
    const routed = knowledgeService.routeEmByDuration('99214', 32);
    expect(routed.code).toBe('99214');
    expect(routed.downgraded).toBe(false);
  });

  test('99213 is unchanged regardless of duration', () => {
    expect(knowledgeService.routeEmByDuration('99213', 10).code).toBe('99213');
    expect(knowledgeService.routeEmByDuration('99213', 50).code).toBe('99213');
  });

  test('validateCptDuration enforces 99214/99215 thresholds', () => {
    expect(knowledgeService.validateCptDuration('99214', 29).valid).toBe(false);
    expect(knowledgeService.validateCptDuration('99214', 30).valid).toBe(true);
    expect(knowledgeService.validateCptDuration('99215', 39).valid).toBe(false);
    expect(knowledgeService.validateCptDuration('99215', 40).valid).toBe(true);
  });

  test('computeTimeConfidence caps when duration below E/M threshold', () => {
    const cap = knowledgeService.getPhiTimeCap();
    expect(
      knowledgeService.computeTimeConfidence([{ code: '99215' }], 35)
    ).toBe(cap);
    expect(
      knowledgeService.computeTimeConfidence([{ code: '99215' }], 45)
    ).toBe(1.0);
  });

  test('non-E/M codes pass through routeEmByDuration unchanged', () => {
    const routed = knowledgeService.routeEmByDuration('90834', 20);
    expect(routed.code).toBe('90834');
    expect(routed.downgraded).toBe(false);
  });
});
