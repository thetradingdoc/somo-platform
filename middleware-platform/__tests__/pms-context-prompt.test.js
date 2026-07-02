'use strict';

const { buildPmsContextBlock, pmsContextFromDynamicVars } = require('../services/kelly-rails/prompts/pms-context-block');

describe('buildPmsContextBlock', () => {
  test('returns empty for empty context', () => {
    expect(buildPmsContextBlock({})).toBe('');
    expect(buildPmsContextBlock(null)).toBe('');
  });

  test('includes patient name and returning flag in English', () => {
    const block = buildPmsContextBlock(
      {
        patient_name: 'Jane Doe',
        is_returning: true,
        next_appointment: '2026-07-01 10:00 AM',
        balance_flag: true,
        has_insurance: true
      },
      'en'
    );
    expect(block).toContain('Patient name: Jane Doe');
    expect(block).toContain('returning patient');
    expect(block).toContain('Next appointment');
    expect(block).toContain('Insurance on file');
    expect(block).toContain('Outstanding balance');
  });

  test('Spanish locale', () => {
    const block = buildPmsContextBlock({ patient_name: 'María López', is_returning: true }, 'es');
    expect(block).toContain('Nombre del paciente: María López');
    expect(block).toContain('recurrente');
  });
});

describe('pmsContextFromDynamicVars', () => {
  test('parses Retell dynamic variables', () => {
    const ctx = pmsContextFromDynamicVars({
      pms_context: 'yes',
      patient_name: 'Jane Doe',
      is_returning: 'yes',
      next_appointment: '2026-07-01 10:00',
      balance_flag: 'no',
      has_insurance: 'yes'
    });
    expect(ctx).toEqual({
      patient_name: 'Jane Doe',
      is_returning: true,
      next_appointment: '2026-07-01 10:00',
      balance_flag: false,
      has_insurance: true
    });
  });

  test('returns null when no PMS signals', () => {
    expect(pmsContextFromDynamicVars({ clinic_id: 'x' })).toBeNull();
  });
});
