'use strict';

const {
  normalizeL2Handoff,
  enforceHandoffOnlyRouting,
  REQUIRED_HANDOFF_FIELDS
} = require('../services/kelly-rails/handoff-contract');

describe('L2→L4 handoff contract', () => {
  test('normalizeL2Handoff extracts required fields from executeTurn input', () => {
    const { valid, handoff, missing } = normalizeL2Handoff({
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'booking',
      active_subrail_step: 'slot_lookup',
      kelly_lane_hint: 'booking',
      flags: { booking_intents: [{ type: 'ask_availability' }] }
    });

    expect(valid).toBe(true);
    expect(missing).toEqual([]);
    expect(handoff.conversation_mode).toBe('tenant_inbound_admin');
    expect(handoff.active_subrail).toBe('booking');
    expect(handoff.kelly_lane_hint).toBe('booking');
    expect(REQUIRED_HANDOFF_FIELDS.every((f) => handoff[f])).toBe(true);
  });

  test('enforceHandoffOnlyRouting true when enforce + mode set', () => {
    expect(enforceHandoffOnlyRouting(true, { conversation_mode: 'tenant_records' })).toBe(true);
    expect(enforceHandoffOnlyRouting(true, {})).toBe(false);
  });
});
