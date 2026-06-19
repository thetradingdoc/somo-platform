'use strict';

const {
  attemptEscalation,
  resolvePstnTarget,
  normalizeE164
} = require('../services/escalation-service');

describe('escalation-service', () => {
  const db = {
    getClinicById: (id) =>
      id === 'c1'
        ? { transfer_number: '+15559876543' }
        : null,
    insertHandoffEscalation: jest.fn(),
    insertKellyCallEvent: jest.fn()
  };

  beforeEach(() => {
    db.insertHandoffEscalation.mockClear();
    db.insertKellyCallEvent.mockClear();
    delete process.env.CALLSOMO_OPERATOR_FALLBACK_PSTN;
    delete process.env.CALLSOMO_OPERATOR_TWILIO_NUMBER;
    delete process.env.TWILIO_PHONE_NUMBER;
  });

  test('normalizeE164 formats US 10-digit', () => {
    expect(normalizeE164('5551234567')).toBe('+15551234567');
  });

  test('resolvePstnTarget prefers clinic transfer_number', () => {
    const t = resolvePstnTarget(db, { clinicId: 'c1' });
    expect(t.source).toBe('clinic_transfer');
    expect(t.number).toBe('+15559876543');
  });

  test('attemptEscalation with PSTN returns transfer_number', () => {
    const out = attemptEscalation(db, { clinicId: 'c1', reason: 'test' });
    expect(out.outcome).toBe('transfer_requested');
    expect(out.transfer_number).toBe('+15559876543');
    expect(db.insertHandoffEscalation).toHaveBeenCalled();
  });

  test('attemptEscalation without PSTN returns ER copy', () => {
    const out = attemptEscalation({}, { reason: 'no_pstn' });
    expect(out.outcome).toBe('no_pstn_configured');
    expect(out.reply).toMatch(/911/);
    expect(out.end_call).toBe(true);
  });
});
