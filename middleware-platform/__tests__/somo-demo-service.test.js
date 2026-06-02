'use strict';

const { getUseCaseContext } = require('../services/somo-demo-service');

describe('somo-demo-service', () => {
  test('getUseCaseContext returns label and opener per use case', () => {
    const ctx = getUseCaseContext('appointment_setter');
    expect(ctx.use_case_label).toBe('Appointment Setter');
    expect(ctx.use_case_opener).toMatch(/appointment/i);
  });

  test('unknown use case falls back to receptionist opener', () => {
    const ctx = getUseCaseContext('unknown');
    expect(ctx.use_case_opener).toMatch(/receptionist/i);
  });
});
