'use strict';

const { handleOperatorOutboundTurn } = require('../services/conversation-mode/rails/operator-outbound-rail');

describe('operator outbound confirm', () => {
  test('yes on reminder confirms appointment', async () => {
    const result = await handleOperatorOutboundTurn({
      message: 'yes I will be there',
      operator_stage: 'update',
      opener_delivered: true,
      outbound_purpose: 'appointment_reminder',
      appointment_id: 'apt_test_1',
      patientName: 'Jane'
    });
    expect(result.disposition).toBe('appointment_confirmed');
    expect(result.endCall).toBe(true);
    expect(result.toolsUsed?.[0]?.name).toBe('confirm_appointment');
  });

  test('know does not trigger close disposition', async () => {
    const result = await handleOperatorOutboundTurn({
      message: 'I know my appointment is tomorrow',
      operator_stage: 'update',
      opener_delivered: true,
      outbound_purpose: 'appointment_reminder',
      appointment_id: 'apt_test_2',
      patientName: 'Jane'
    });
    expect(result.disposition).not.toBe('reminder_delivered');
    expect(result.endCall).not.toBe(true);
  });

  test('cancel is handled before close patterns', async () => {
    const result = await handleOperatorOutboundTurn({
      message: 'no I need to cancel',
      operator_stage: 'update',
      opener_delivered: true,
      outbound_purpose: 'appointment_reminder',
      appointment_id: 'apt_test_3',
      patientName: 'Jane'
    });
    expect(result.disposition).toBe('cancel_requested');
    expect(result.conversation_mode).toBe('tenant_inbound_admin');
  });
});
