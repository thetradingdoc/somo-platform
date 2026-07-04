'use strict';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { repairRescheduleOverCancel, isCancelOnlyReply } = require('../services/kelly-rails/reply-repair');

jest.mock('../services/kelly-tool-executor', () => ({
  _getSessionMeta: jest.fn()
}));

describe('reply-repair', () => {
  beforeEach(() => {
    KellyToolExecutor._getSessionMeta.mockImplementation((sid, key) => {
      const map = { last_slot_date: '2026-07-08', last_slot_time: '09:00' };
      return map[key] || null;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('isCancelOnlyReply detects cancel without reschedule wording', () => {
    expect(isCancelOnlyReply('Your appointment has been canceled.')).toBe(true);
    expect(isCancelOnlyReply('Your appointment has been rescheduled to Monday.')).toBe(false);
  });

  test('repairRescheduleOverCancel swaps cancel-only reply when reschedule tool ran', () => {
    const reply = repairRescheduleOverCancel(
      'Your appointment has been canceled.',
      { locale: 'en' },
      ['cancel_appointment', 'reschedule_appointment'],
      { sessionId: 'sess_en2', locale: 'en' }
    );
    expect(reply).toMatch(/rescheduled/i);
    expect(reply).toMatch(/2026-07-08/);
  });

  test('repairRescheduleOverCancel leaves reply unchanged without reschedule tool', () => {
    const original = 'Your appointment has been canceled.';
    expect(
      repairRescheduleOverCancel(original, { locale: 'en' }, ['cancel_appointment'], {
        sessionId: 'sess_en2'
      })
    ).toBe(original);
  });
});
