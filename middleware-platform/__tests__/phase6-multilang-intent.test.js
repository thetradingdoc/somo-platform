'use strict';

const { primaryIntent } = require('../services/conversation-mode/intent-detector');
const { detectRescheduleIntents } = require('../services/kelly-rails/turn-planner');
const { resolveRagRuntimeOptions } = require('../services/voice-rag-config');
const { shouldRunCodingStateOnTranscript } = require('../services/voice-coding-hot-path');
const { resolveVoiceFillerDelayMs } = require('../services/voice-turn-filler');
const { withKellyTurnTimeout, KELLY_TURN_TIMEOUT_MS } = require('../services/kelly-turn-resolver');
const SMSService = require('../services/sms-service');
const { getNextQuestion } = require('../services/clinical-opqrst-registry');
const {
  resolveAdminVisitCodes,
  isClinicAdminUseCase
} = require('../services/resolve-admin-visit-codes');

describe('Phase 6 multilang intent (6.7 / 6.8)', () => {
  test('ES-3 turn 2 detects reschedule not cancel-only', () => {
    const intent = primaryIntent('¿Podemos cambiarla para la próxima semana?');
    expect(intent.intent).toBe('reschedule');
  });

  test('RU-3 turn 2 fee question stays cancel context not reschedule', () => {
    const intent = primaryIntent('Есть ли штраф за отмену?');
    expect(intent.intent).toBe('cancel');
    expect(detectRescheduleIntents('Есть ли штраф за отмену?', 'find_booking')).toHaveLength(0);
  });

  test('ZH booking utterance detects book intent', () => {
    expect(primaryIntent('你好，我想预约洗牙。').intent).toBe('book');
  });

  test('Mandarin copay SMS template localized', () => {
    const body = SMSService.formatCopayPaymentSms({
      locale: 'zh',
      clinicName: 'Somo',
      amount: 25,
      paymentLink: 'https://pay.test/t'
    });
    expect(body).toMatch(/自付|支付/);
  });

  test('zh OPQRST pack serves scripted question', () => {
    const q = getNextQuestion('zh', 'opqrst_onset', 'Dermatology');
    expect(q?.text).toMatch(/什么时候/);
  });
});

describe('Phase 6 latency helpers (6.1–6.6)', () => {
  test('voice RAG disables HyDE and caps timeout at 2s', () => {
    const opts = resolveRagRuntimeOptions('voice');
    expect(opts.hydeEnabled).toBe(false);
    expect(opts.remoteTimeoutMs).toBeLessThanOrEqual(2000);
  });

  test('non-voice RAG keeps HyDE default and 8s timeout', () => {
    const prev = process.env.REMOTE_RAG_TIMEOUT_MS;
    process.env.REMOTE_RAG_TIMEOUT_MS = '8000';
    const opts = resolveRagRuntimeOptions('chat');
    expect(opts.hydeEnabled).toBe(true);
    expect(opts.remoteTimeoutMs).toBe(8000);
    if (prev === undefined) delete process.env.REMOTE_RAG_TIMEOUT_MS;
    else process.env.REMOTE_RAG_TIMEOUT_MS = prev;
  });

  test('coding state machine skipped for routine booking utterance', () => {
    expect(shouldRunCodingStateOnTranscript('I want to book a cleaning', {})).toBe(false);
    expect(shouldRunCodingStateOnTranscript('What CPT code applies?', {})).toBe(true);
  });

  test('filler delay adapts faster for booking than symptom turns', () => {
    const fast = resolveVoiceFillerDelayMs({ message: 'I want to book a cleaning' });
    const slow = resolveVoiceFillerDelayMs({ message: 'I have a rash on my arm' });
    expect(fast).toBeLessThan(slow);
  });

  test('runKellyTurn timeout degrades gracefully', async () => {
    const out = await withKellyTurnTimeout(
      new Promise((resolve) => setTimeout(() => resolve({ reply: 'late' }), 500)),
      { channel: 'voice', locale: 'en', timeoutMs: 50 }
    );
    expect(out.turn_timeout).toBe(true);
    expect(out.reply).toMatch(/still working|moment/i);
  });

  test('KELLY_TURN_TIMEOUT_MS defaults to 25s', () => {
    expect(KELLY_TURN_TIMEOUT_MS).toBeGreaterThanOrEqual(25000);
  });
});

describe('Phase 6 vertical admin paths (6.12)', () => {
  test('healthcare_clinic maps annual physical to E/M not dental CDT', () => {
    expect(isClinicAdminUseCase('healthcare_clinic')).toBe(true);
    const r = resolveAdminVisitCodes('annual physical checkup', 'healthcare_clinic');
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toBe('99395');
    expect(r.code_source).toBe('admin_clinic_em');
  });

  test('small_business maps office visit to E/M', () => {
    const r = resolveAdminVisitCodes('general office visit', 'small_business');
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toMatch(/^99/);
  });
});
