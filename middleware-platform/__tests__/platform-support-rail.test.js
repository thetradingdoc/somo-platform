'use strict';

const { handlePlatformSupportTurn, OPENER } = require('../services/conversation-mode/rails/platform-support-rail');

describe('platform-support-rail', () => {
  test('greeting opener includes consent language', async () => {
    const out = await handlePlatformSupportTurn({ message: '', opener_delivered: false });
    expect(out.conversation_mode).toBe('platform_support');
    expect(out.reply).toContain('Somo');
    expect(OPENER).toMatch(/recorded/i);
  });

  test('handoff request triggers transfer path', async () => {
    const out = await handlePlatformSupportTurn({
      message: 'I need to speak to a human please',
      opener_delivered: true,
      platform_stage: 'triage'
    });
    expect(out.active_subrail).toBe('handoff');
    expect(out.flags?.pending_human_handoff).toBe(true);
  });

  test('tenant caller gets tenant help stage', async () => {
    const out = await handlePlatformSupportTurn({
      message: 'hi',
      caller_type: 'tenant',
      tenant_name: 'Bright Dental',
      opener_delivered: true
    });
    expect(out.caller_type).toBe('tenant');
    expect(out.platform_stage).toBe('tenant_help');
    expect(out.reply).toMatch(/account|billing|Somo customer/i);
  });

  test('sales lead signup intent classifies caller', async () => {
    const out = await handlePlatformSupportTurn({
      message: 'I want to sign up for Somo',
      opener_delivered: true,
      platform_stage: 'practice_type'
    });
    expect(out.caller_type).toBe('sales_lead');
  });
});
