'use strict';

describe('dodgecall-template-registry', () => {
  const orig = {
    dodgeAgent: process.env.DODGECALL_RETELL_AGENT_ID,
    dodgeFrom: process.env.DODGECALL_TWILIO_FROM_NUMBER,
    retellAgent: process.env.RETELL_AGENT_ID,
    retellSales: process.env.RETELL_SALES_AGENT_ID,
    twilio: process.env.TWILIO_PHONE_NUMBER
  };

  afterEach(() => {
    for (const [key, val] of Object.entries(orig)) {
      const envKey =
        key === 'dodgeAgent'
          ? 'DODGECALL_RETELL_AGENT_ID'
          : key === 'dodgeFrom'
            ? 'DODGECALL_TWILIO_FROM_NUMBER'
            : key === 'retellAgent'
              ? 'RETELL_AGENT_ID'
              : key === 'retellSales'
                ? 'RETELL_SALES_AGENT_ID'
                : 'TWILIO_PHONE_NUMBER';
      if (val !== undefined) process.env[envKey] = val;
      else delete process.env[envKey];
    }
    jest.resetModules();
  });

  test('resolveTemplate prefers DODGECALL_* when set', () => {
    process.env.DODGECALL_RETELL_AGENT_ID = 'agent_demo_test';
    process.env.DODGECALL_TWILIO_FROM_NUMBER = '+15555550100';
    jest.resetModules();
    const { resolveTemplate } = require('../services/dodgecall-template-registry');
    const t = resolveTemplate({ use_case: 'receptionist' });
    expect(t.template_id).toBe('medical');
    expect(t.agentId).toBe('agent_demo_test');
    expect(t.fromNumber).toBe('+15555550100');
    expect(t.personaName).toBe('Sam');
    expect(t.maxDurationSec).toBeGreaterThan(0);
  });

  test('resolveTemplate falls back to RETELL_AGENT_ID and TWILIO_PHONE_NUMBER', () => {
    delete process.env.DODGECALL_RETELL_AGENT_ID;
    delete process.env.DODGECALL_TWILIO_FROM_NUMBER;
    delete process.env.RETELL_SALES_AGENT_ID;
    process.env.RETELL_AGENT_ID = 'agent_kelly_fallback';
    process.env.TWILIO_PHONE_NUMBER = '+15555550999';
    jest.resetModules();
    const { resolveTemplate } = require('../services/dodgecall-template-registry');
    const t = resolveTemplate({ use_case: 'receptionist' });
    expect(t.agentId).toBe('agent_kelly_fallback');
    expect(t.fromNumber).toBe('+15555550999');
  });

  test('resolveTemplate throws when all agent keys missing', () => {
    delete process.env.DODGECALL_RETELL_AGENT_ID;
    delete process.env.RETELL_SALES_AGENT_ID;
    delete process.env.RETELL_AGENT_ID;
    process.env.DODGECALL_TWILIO_FROM_NUMBER = '+15555550100';
    jest.resetModules();
    const { resolveTemplate } = require('../services/dodgecall-template-registry');
    expect(() => resolveTemplate({ use_case: 'survey' })).toThrow(
      /DODGECALL_RETELL_AGENT_ID|RETELL_AGENT_ID/
    );
  });

  test.each([
    'dental_front_desk',
    'medical_clinic',
    'specialty_practice',
    'bilingual_front_desk',
    'after_hours',
    'patient_billing'
  ])('healthcare use case %s resolves medical template', (useCase) => {
    process.env.DODGECALL_RETELL_AGENT_ID = 'agent_demo_test';
    process.env.DODGECALL_TWILIO_FROM_NUMBER = '+15555550100';
    jest.resetModules();
    const { resolveTemplate } = require('../services/dodgecall-template-registry');
    const t = resolveTemplate({ use_case: useCase });
    expect(t.template_id).toBe('medical');
  });
});
