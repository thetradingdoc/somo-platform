'use strict';

process.env.KELLY_RAILS_V2 = '1';
process.env.KELLY_ALLOW_HYBRID_GRAPH = '0';
process.env.KELLY_RAILS_ROLLOUT_PCT = '1';
process.env.LANGGRAPH_KELLY_ROLLOUT_PCT = '0';
process.env.KELLY_LANG_MIN_CONFIDENCE = '0.99';

const { runKellyTurn } = require('../services/kelly-turn-resolver');

describe('Kelly Rails language handoff (integration)', () => {
  test('Spanish first message below confidence threshold → support lane, no booking tools', async () => {
    const sessionId = `lang-handoff-${Date.now()}`;
    const out = await runKellyTurn({
      sessionId,
      message: 'Hola, gracias por favor',
      channel: 'chat',
      patientId: 'patient-test-1',
      clinicId: 'clinic-default'
    });

    expect(out?.reply).toMatch(/especialista|support|idioma|soporte/i);
    expect(out?.toolsUsed || []).toEqual([]);
    expect(out?.kelly_rails?.active_lane).toBe('support');
  });
});
