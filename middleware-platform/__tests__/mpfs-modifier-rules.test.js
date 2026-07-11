'use strict';

const knowledgeService = require('../services/knowledge-service');

describe('MPFS modifier rules (BL-02)', () => {
  test('requires -25 on E/M when procedure on same visit', () => {
    const required = knowledgeService.getRequiredModifiers(['99214', '93000']);
    expect(required.get('99214')).toEqual(['-25']);
    expect(required.has('93000')).toBe(false);
  });

  test('requires -25 on E/M with biopsy procedure', () => {
    const required = knowledgeService.getRequiredModifiers(['99213', '11102']);
    expect(required.get('99213')).toEqual(['-25']);
  });

  test('requires -59 on secondary procedure when multiple procedures', () => {
    const required = knowledgeService.getRequiredModifiers(['11102', '11104']);
    expect(required.get('11104')).toEqual(['-59']);
  });

  test('requires -59 on secondary when E/M plus multiple procedures', () => {
    const required = knowledgeService.getRequiredModifiers(['99214', '20610', '12001']);
    expect(required.get('99214')).toEqual(['-25']);
    expect(required.get('12001')).toEqual(['-59']);
  });

  test('returns empty map for single code', () => {
    const required = knowledgeService.getRequiredModifiers(['99214']);
    expect(required.size).toBe(0);
  });

  test('validateModifiers flags missing -25', () => {
    const result = knowledgeService.validateModifiers([
      { code: '99214', modifiers: [] },
      { code: '93000', modifiers: [] }
    ]);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual([
      { code: '99214', missingModifiers: ['-25'] }
    ]);
  });

  test('validateModifiers passes when -25 present on E/M', () => {
    const result = knowledgeService.validateModifiers([
      { code: '99214', modifiers: ['-25'] },
      { code: '93000', modifiers: [] }
    ]);
    expect(result.valid).toBe(true);
  });

  test('computeModifierConfidence applies phi cap when modifiers missing', () => {
    const rules = knowledgeService.loadModifierRules();
    const cap = rules.phi_modifier_cap ?? 0.6;
    expect(
      knowledgeService.computeModifierConfidence([
        { code: '99213', modifiers: [] },
        { code: '93000', modifiers: [] }
      ])
    ).toBe(cap);
    expect(
      knowledgeService.computeModifierConfidence([
        { code: '99213', modifiers: ['-25'] },
        { code: '93000', modifiers: [] }
      ])
    ).toBe(1.0);
  });
});
