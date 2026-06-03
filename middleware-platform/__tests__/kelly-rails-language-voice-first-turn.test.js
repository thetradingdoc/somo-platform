'use strict';

process.env.KELLY_RAILS_V2 = '1';
process.env.KELLY_RAILS_ROLLOUT_PCT = '1';

const db = require('../database');
const { runKellyTurn } = require('../services/kelly-turn-resolver');

describe('kelly voice first-turn language', () => {
  jest.setTimeout(60_000);

  test('Spanish opener sets session language es', async () => {
    const sessionId = `e2e_voice_es_${Date.now()}`;
    await runKellyTurn({
      sessionId,
      message: 'Hola, me duele la pierna',
      channel: 'voice',
      clinicId: 'clinic-default'
    });
    const lang = db.getKellySessionLanguage(sessionId);
    expect(lang).toBe('es');
  });
});
