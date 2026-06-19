'use strict';

const { buildTransferResponse, sendEscalationReply } = require('../services/retell-transfer');

describe('retell-transfer (T-018)', () => {
  test('buildTransferResponse includes transfer_number and no_interruption_allowed on same frame', () => {
    const payload = buildTransferResponse({
      content: 'Let me connect you.',
      responseId: 7,
      transferNumber: '+15551234567'
    });
    expect(payload).toMatchObject({
      response_type: 'response',
      response_id: 7,
      content: 'Let me connect you.',
      content_complete: true,
      transfer_number: '+15551234567',
      no_interruption_allowed: true
    });
  });

  test('sendEscalationReply sends single payload via callback', () => {
    const sent = [];
    sendEscalationReply((p) => sent.push(p), {
      content: 'Connecting now.',
      responseId: 2,
      transferNumber: '+15559998888'
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].transfer_number).toBe('+15559998888');
    expect(sent[0].no_interruption_allowed).toBe(true);
    expect(sent[0].content).toBe('Connecting now.');
  });

  test('endCall without transfer omits transfer_number', () => {
    const payload = buildTransferResponse({
      content: 'Goodbye.',
      responseId: 0,
      endCall: true,
      noInterruptionAllowed: false
    });
    expect(payload.end_call).toBe(true);
    expect(payload.transfer_number).toBeUndefined();
  });
});
