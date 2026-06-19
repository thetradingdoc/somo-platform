'use strict';

const { buildMissingRetellTwiml } = require('../services/voice-inbound-tenant');

describe('buildMissingRetellTwiml Dial fallback', () => {
  test('includes Dial when PSTN resolved via escalation', () => {
    const db = {
      getClinicById: () => ({ transfer_number: '+15553334444' }),
      insertHandoffEscalation: () => {},
      insertKellyCallEvent: () => {}
    };
    const twiml = buildMissingRetellTwiml('Connecting you now.', {
      db,
      clinicId: 'clinic-x',
      sessionId: 'call-1',
      callId: 'call-1'
    });
    expect(twiml).toContain('<Dial>+15553334444</Dial>');
    expect(twiml).toContain('<Hangup');
  });

  test('Hangup only when no PSTN', () => {
    const twiml = buildMissingRetellTwiml('Please try again.');
    expect(twiml).not.toContain('<Dial');
    expect(twiml).toContain('<Hangup');
  });
});
