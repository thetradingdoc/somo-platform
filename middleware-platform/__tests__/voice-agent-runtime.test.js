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
      greeting: 'Hi'
    };
    const r = evaluateCallAdmission(runtime);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('disabled');
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
