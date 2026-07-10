'use strict';

const { handleOutboundSalesTurn, stageReply } = require('../services/conversation-mode/rails/outbound-sales-rail');

describe('outbound-sales-rail', () => {
  test('intro uses Kelly not Alex', () => {
    const intro = stageReply('intro', { leadName: 'Maria' });
    expect(intro).toMatch(/Kelly/i);
    expect(intro).not.toMatch(/Alex/i);
  });

  test('handleOutboundSalesTurn returns Kelly persona', async () => {
    const out = await handleOutboundSalesTurn({ message: 'yes go ahead', sales_stage: 'intro' });
    expect(out.reply).toMatch(/Kelly/i);
    expect(out.conversation_mode).toBe('outbound_sales');
  });
});
