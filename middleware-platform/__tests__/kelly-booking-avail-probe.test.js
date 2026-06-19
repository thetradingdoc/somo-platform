'use strict';

const KellyToolExecutor = require('../services/kelly-tool-executor');

describe('CR-027b booking lane-entry availability probe', () => {
  const origProbe = process.env.KELLY_BOOKING_AVAIL_PROBE;
  let executeSpy;

  beforeEach(() => {
    process.env.KELLY_BOOKING_AVAIL_PROBE = '1';
    executeSpy = jest
      .spyOn(KellyToolExecutor, 'execute')
      .mockResolvedValue({ slot_bundles: [] });
  });

  afterEach(() => {
    executeSpy.mockRestore();
    if (origProbe !== undefined) process.env.KELLY_BOOKING_AVAIL_PROBE = origProbe;
    else delete process.env.KELLY_BOOKING_AVAIL_PROBE;
  });

  test('empty slots redirect booking lane to support handoff', async () => {
    const { executeTurn } = require('../services/kelly-rails/execute-turn');
    const db = {
      getTriageSession: jest.fn(() => ({ target_specialty: 'Dermatology' })),
      getRailsSessionProjection: jest.fn(() => null)
    };
    const sessionId = 'probe-sess-' + Date.now();
    const out = await executeTurn({
      sessionId,
      db,
      channel: 'voice',
      patientId: 'Patient/test',
      active_lane: 'booking',
      step: 'schedule_visit',
      message: 'I want to book an appointment',
      flags: { _lane_export: 'booking' },
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'booking'
    });
    expect(executeSpy).toHaveBeenCalledWith(
      'get_available_slots',
      expect.objectContaining({ days_ahead: 14 }),
      expect.objectContaining({ sessionId, db })
    );
  });
});
