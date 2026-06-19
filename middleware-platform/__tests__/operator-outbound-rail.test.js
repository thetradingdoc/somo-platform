'use strict';

const {
  isVoicemailOrIvrUtterance,
  isOptOutUtterance,
  handleOperatorOutboundTurn
} = require('../services/conversation-mode/rails/operator-outbound-rail');

describe('operator outbound (O-2, O-4)', () => {
  test('voicemail utterance ends call', async () => {
    const r = await handleOperatorOutboundTurn({
      message: 'You have reached the voicemail please leave a message',
      opener_delivered: true,
      operator_stage: 'update'
    });
    expect(r.endCall).toBe(true);
    expect(r.disposition).toBe('voicemail');
  });

  test('opt-out ends call', async () => {
    const r = await handleOperatorOutboundTurn({
      message: "don't call me again",
      opener_delivered: true
    });
    expect(r.endCall).toBe(true);
    expect(r.disposition).toBe('opt_out');
  });

  test('live answer continues operator_outbound mode', async () => {
    const r = await handleOperatorOutboundTurn({
      message: 'yes I have a moment',
      opener_delivered: true,
      operator_stage: 'callback_intro'
    });
    expect(r.conversation_mode).toBe('operator_outbound');
    expect(r.endCall).not.toBe(true);
  });
});
