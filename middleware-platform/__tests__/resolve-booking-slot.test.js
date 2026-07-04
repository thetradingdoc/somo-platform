'use strict';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { resolveBookingSlot } = require('../services/kelly-rails/gates/shared');

jest.mock('../services/kelly-tool-executor', () => ({
  _setSessionMeta: jest.fn(),
  _getSessionMeta: jest.fn()
}));

describe('resolveBookingSlot', () => {
  beforeEach(() => {
    KellyToolExecutor._getSessionMeta.mockImplementation((sid, key) => {
      if (key === 'last_slot_date') return '2026-07-07';
      if (key === 'last_slot_time') return '14:00';
      return null;
    });
    KellyToolExecutor._setSessionMeta.mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('keeps offered slot date on confirmatory Tuesday mention', () => {
    const state = { flags: {} };
    const ctx = {
      sessionId: 'sess_book',
      message: 'Yes, next Tuesday afternoon works great'
    };
    const { apptDate, apptTime } = resolveBookingSlot(state, ctx);
    expect(apptDate).toBe('2026-07-07');
    expect(apptTime).toBe('14:00');
  });

  test('parses Tuesday when no slot bound yet', () => {
    KellyToolExecutor._getSessionMeta.mockImplementation(() => null);
    const state = { flags: {} };
    const ctx = {
      sessionId: 'sess_new',
      message: 'Tuesday afternoon works'
    };
    const { apptDate, apptTime } = resolveBookingSlot(state, ctx);
    expect(apptDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(apptTime).toBe('14:00');
  });
});
