'use strict';

const {
  isWithinBusinessHours,
  evaluateCallAdmission,
  buildDefaultGreeting,
  formatCallerLabel,
  formatCallerLabelFromCallRow,
  detectTransferHint,
  outcomeForScheduledAppointment,
  resolveCallEndOutcome
} = require('../services/voice-agent-runtime');

describe('voice-agent-runtime', () => {
  test('isWithinBusinessHours accepts mon 09:00-17:00', () => {
    const mon10 = new Date('2026-06-01T15:00:00');
    const day = mon10.getDay();
    const testDate =
      day === 1
        ? mon10
        : new Date('2026-06-02T15:00:00');
    const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][testDate.getDay()];
    const scoped = { [key]: '09:00-17:00' };
    expect(isWithinBusinessHours(scoped, testDate)).toBe(true);
  });

  test('evaluateCallAdmission blocks when paused', () => {
    const runtime = {
      agentEnabled: false,
      unavailableMessage: 'Unavailable',
      afterHoursMessage: 'Closed',
      businessHours: null,
      greeting: 'Hi',
      transferNumber: '+15551112222',
      coverageMode: 'full_replacement',
      coverageHours: null,
      afterHoursAction: 'message_only'
    };
    const r = evaluateCallAdmission(runtime);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('disabled');
    expect(r.action).toBe('forward_pstn');
    expect(r.transferNumber).toBe('+15551112222');
  });

  test('evaluateCallAdmission forwards when coverage off', () => {
    const wed10 = new Date('2026-06-03T15:00:00');
    const runtime = {
      agentEnabled: true,
      unavailableMessage: 'Unavailable',
      afterHoursMessage: 'Kelly is off shift.',
      businessHours: { wed: '09:00-17:00' },
      coverageMode: 'coverage',
      coverageHours: { mon: '09:00-12:00' },
      afterHoursAction: 'message_only',
      transferNumber: '+15559998888',
      greeting: 'Hi'
    };
    const r = evaluateCallAdmission(runtime, wed10);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('coverage_off');
    expect(r.action).toBe('forward_pstn');
  });

  test('evaluateCallAdmission after_hours transfer when configured', () => {
    const sun10 = new Date('2026-06-07T15:00:00');
    const runtime = {
      agentEnabled: true,
      unavailableMessage: 'Unavailable',
      afterHoursMessage: 'Closed.',
      businessHours: { mon: '09:00-17:00' },
      coverageMode: 'full_replacement',
      coverageHours: null,
      afterHoursAction: 'transfer',
      transferNumber: '+15557776666',
      greeting: 'Hi'
    };
    const r = evaluateCallAdmission(runtime, sun10);
    expect(r.reason).toBe('after_hours');
    expect(r.action).toBe('forward_pstn');
    expect(r.transferNumber).toBe('+15557776666');
  });

  test('buildDefaultGreeting includes practice name', () => {
    expect(buildDefaultGreeting('Valley Neurology')).toContain('Valley Neurology');
  });

  test('formatCallerLabel prefers name then phone', () => {
    expect(formatCallerLabel({ customerName: 'Jane Doe' })).toBe('Jane Doe');
    expect(formatCallerLabel({ customerPhone: '8085551234' })).toBe('(808) 555-1234');
    expect(formatCallerLabel({})).toBe('Unknown caller');
  });

  test('formatCallerLabelFromCallRow uses stored label', () => {
    expect(formatCallerLabelFromCallRow({ caller_label: 'Sam' })).toBe('Sam');
  });

  test('detectTransferHint matches user and agent phrases', () => {
    expect(detectTransferHint('Can I speak to a person?', null)).toBe('transferred');
    expect(detectTransferHint(null, 'Let me connect you with our staff.')).toBe('transferred');
    expect(detectTransferHint('book an appointment', null)).toBeNull();
  });

  test('outcomeForScheduledAppointment flags PA', () => {
    expect(outcomeForScheduledAppointment({ requires_prior_auth: 1 })).toBe('pa_flagged');
    expect(outcomeForScheduledAppointment({})).toBe('booked');
  });

  test('resolveCallEndOutcome respects hint and duration', () => {
    expect(
      resolveCallEndOutcome({
        callLog: null,
        connection: { voiceOutcomeHint: 'transferred' },
        callDurationSeconds: 120,
        db: null
      })
    ).toBe('transferred');
    expect(
      resolveCallEndOutcome({
        callLog: { outcome: 'pa_flagged' },
        connection: null,
        callDurationSeconds: 120,
        db: null
      })
    ).toBe('pa_flagged');
    expect(
      resolveCallEndOutcome({
        callLog: null,
        connection: null,
        callDurationSeconds: 10,
        db: null
      })
    ).toBe('voicemail');
  });
});
