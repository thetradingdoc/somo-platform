'use strict';

const {
  detectRescheduleIntents,
  applyRescheduleIntentsToFlags,
  applyCancelIntentsToFlags,
  detectCancelIntents,
  planTurnOwner,
  BookingIntentType
} = require('../services/kelly-rails/turn-planner');
const { primaryIntent } = require('../services/conversation-mode/intent-detector');
const { UserIntent } = require('../services/conversation-mode/conversation-mode-types');

describe('turn-planner reschedule intents', () => {
  test('detects move-to-next-week phrasing', () => {
    const intents = detectRescheduleIntents('Actually, can we just move it to next week instead?');
    expect(intents.some((i) => i.type === 'reschedule_requested')).toBe(true);
  });

  test('detects Spanish reschedule phrasing', () => {
    const intents = detectRescheduleIntents('¿Podemos cambiarla para la próxima semana?');
    expect(intents.some((i) => i.type === 'reschedule_requested')).toBe(true);
  });

  test('reschedule pending suppresses cancel flags', () => {
    const flags = {};
    applyRescheduleIntentsToFlags(flags, detectRescheduleIntents('move it to next week'));
    applyCancelIntentsToFlags(flags, [{ type: 'cancel_requested' }]);
    expect(flags.reschedule_pending).toBe(true);
    expect(flags.cancel_pending).toBe(true);
  });

  test('detects Russian cancel phrasing', () => {
    const intents = detectCancelIntents('Мне нужно отменить приём, у меня изменились планы.');
    expect(intents.some((i) => i.type === 'cancel_requested')).toBe(true);
  });

  test('planTurnOwner routes confirm_book to schedule when slots_offered', () => {
    const plan = planTurnOwner({
      subrail: 'booking',
      flags: { slots_offered: true },
      intents: [{ type: BookingIntentType.CONFIRM_BOOK }]
    });
    expect(plan).toEqual({ owner: 'gate', gateId: 'schedule' });
  });

  test('Spanish copay utterance maps to PAY_COPAY', () => {
    const intent = primaryIntent('Quiero saber cuánto tendría que pagar por una limpieza.');
    expect(intent.intent).toBe(UserIntent.PAY_COPAY);
  });

  test('Russian copay utterance maps to PAY_COPAY', () => {
    const intent = primaryIntent('Сколько будет стоить приём?');
    expect(intent.intent).toBe(UserIntent.PAY_COPAY);
  });
});
