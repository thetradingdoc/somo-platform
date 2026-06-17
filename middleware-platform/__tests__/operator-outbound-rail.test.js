'use strict';

const { handleOperatorOutboundTurn, stageReply } = require('../services/conversation-mode/rails/operator-outbound-rail');

describe('operator-outbound-rail', () => {
  test('callback_intro when opener not yet delivered', async () => {
    const out = await handleOperatorOutboundTurn({ message: 'hello' });
    expect(out.operator_stage).toBe('update');
    expect(out.reply).toContain('Kelly calling from Somo');
  });

  test('skips callback_intro when opener_delivered', async () => {
    const out = await handleOperatorOutboundTurn({
      opener_delivered: true,
      message: 'yes hi'
    });
    expect(out.reply).not.toMatch(/Kelly calling from Somo with a quick follow-up/);
    expect(out.operator_stage).toBe('confirm');
  });

  test('stageReply callback_intro mentions Somo', () => {
    expect(stageReply('callback_intro', {})).toContain('Somo');
  });
});
