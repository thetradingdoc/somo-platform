'use strict';

const {
  maskPhone,
  maskEmail,
  redactPatient,
  redactEligibility,
  redactTriageSession,
  redactConversationTurn,
  redactHealthTranscript
} = require('../services/tenant-phi-export-service');

describe('tenant-phi-export-service', () => {
  test('maskPhone keeps last 4', () => {
    expect(maskPhone('8085551234')).toBe('***-***-1234');
  });

  test('maskEmail redacts local part', () => {
    expect(maskEmail('user@example.com')).toMatch(/@example\.com$/);
  });

  test('redactPatient omits raw phone', () => {
    const row = redactPatient({
      resource_id: 'p1',
      name: 'Jane',
      phone: '8085551234',
      email: 'j@x.com'
    });
    expect(row.phone_masked).toBe('***-***-1234');
    expect(row.phone).toBeUndefined();
  });

  test('redactEligibility omits response_data', () => {
    const row = redactEligibility({
      id: 'e1',
      patient_id: 'p1',
      payer_id: 'BCBS',
      eligible: 1,
      response_data: '{"secret":true}'
    });
    expect(row.response_data).toBeUndefined();
    expect(row.payer_id).toBe('BCBS');
  });

  test('redactTriageSession includes clinical fields without raw RAG payload', () => {
    const row = redactTriageSession({
      id: 't1',
      session_id: 'call_abc',
      quality: 'sharp pain',
      opqrst_complete: 1,
      triage_complete: 0,
      referred_to_911: 0,
      clinic_id: 'clinic_1',
      customer_id: 'cust_1',
      created_at: '2026-01-01',
      updated_at: '2026-01-01'
    });
    expect(row.quality).toBe('sharp pain');
    expect(row.clinic_id).toBe('clinic_1');
    expect(row.rag_result_id).toBeUndefined();
  });

  test('redactConversationTurn preserves turn content for portability', () => {
    const row = redactConversationTurn({
      id: 'h1',
      session_id: 'call_abc',
      role: 'user',
      content: 'I need to book an appointment',
      created_at: '2026-01-01'
    });
    expect(row.content).toContain('appointment');
  });

  test('redactHealthTranscript includes transcript text', () => {
    const row = redactHealthTranscript({
      id: 1,
      session_id: 'call_abc',
      room_id: 'room_1',
      speaker: 'user',
      text: 'symptom description',
      ts: '2026-01-01'
    });
    expect(row.text).toBe('symptom description');
  });
});
