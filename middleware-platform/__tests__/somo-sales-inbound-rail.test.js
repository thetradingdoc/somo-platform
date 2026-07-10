'use strict';

const {
  handleSomoSalesInboundTurn,
  buildPlatformSalesOpener,
  SALES_STAGES,
  FORBIDDEN_PERSONA_RE
} = require('../services/conversation-mode/rails/somo-sales-inbound-rail');

describe('somo-sales-inbound-rail', () => {
  test('opener is Kelly sales with recording consent', () => {
    const opener = buildPlatformSalesOpener();
    expect(opener).toMatch(/Kelly/i);
    expect(opener).toMatch(/recorded/i);
    expect(opener).not.toMatch(FORBIDDEN_PERSONA_RE);
  });

  test('handoff request sets pending_human_handoff', async () => {
    const out = await handleSomoSalesInboundTurn({
      message: 'Can I speak to a human?',
      opener_delivered: true,
      platform_stage: 'practice_type'
    });
    expect(out.active_subrail).toBe('handoff');
    expect(out.flags?.pending_human_handoff).toBe(true);
  });

  test('advances through qualification stages', async () => {
    const out = await handleSomoSalesInboundTurn({
      message: 'We are a dental practice in Austin',
      opener_delivered: true,
      platform_stage: 'practice_type'
    });
    expect(SALES_STAGES).toContain(out.platform_stage);
    expect(out.reply).toMatch(/challenge|missed calls|scheduling|after-hours/i);
  });

  test('tenant caller gets tenant help path', async () => {
    const out = await handleSomoSalesInboundTurn({
      message: 'hi',
      caller_type: 'tenant',
      tenant_name: 'Bright Dental',
      opener_delivered: true
    });
    expect(out.platform_stage).toBe('tenant_help');
    expect(out.reply).toMatch(/account|billing|Somo customer/i);
  });
});
