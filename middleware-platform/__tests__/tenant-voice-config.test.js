'use strict';

const {
  assessConfigStatus,
  voiceHoursToSchedulingColumns,
  parseJsonField
} = require('../services/tenant-voice-config');

describe('tenant-voice-config', () => {
  test('assessConfigStatus flags missing transfer and clinic link', () => {
    const status = assessConfigStatus({
      customer_clinics_linked: false,
      clinic_id: 'clinic-1',
      retell_agent_id: 'agent-1',
      prompt_profile_id: 'pp-1',
      transfer_number: null,
      transfer_fallback_acknowledged: false,
      business_hours: { mon: '09:00-17:00' },
      language_mode: 'en_only',
      clinic_email: null
    });
    expect(status.ready).toBe(false);
    expect(status.missing).toContain('customer_clinics');
    expect(status.missing).toContain('transfer_number');
    expect(status.missing).toContain('clinic_email');
  });

  test('assessConfigStatus ready when all required fields present', () => {
    const status = assessConfigStatus({
      customer_clinics_linked: true,
      clinic_id: 'clinic-1',
      retell_agent_id: 'agent-1',
      prompt_profile_id: 'pp-1',
      transfer_number: '+15551234567',
      business_hours: { mon: '09:00-17:00' },
      language_mode: 'en_only',
      clinic_email: 'frontdesk@clinic.com'
    });
    expect(status.ready).toBe(true);
    expect(status.missing).toHaveLength(0);
  });

  test('voiceHoursToSchedulingColumns maps JSON hours to scheduling columns', () => {
    const cols = voiceHoursToSchedulingColumns({
      mon: '09:00-17:00',
      tue: '09:00-17:00',
      wed: '09:00-17:00',
      thu: '09:00-17:00',
      fri: '09:00-17:00'
    });
    expect(cols.business_days).toEqual(expect.arrayContaining([1, 2, 3, 4, 5]));
    expect(cols.business_hours_start).toBe(9);
    expect(cols.business_hours_end).toBe(17);
  });

  test('parseJsonField handles object and string JSON', () => {
    expect(parseJsonField('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonField({ b: 2 })).toEqual({ b: 2 });
  });
});
