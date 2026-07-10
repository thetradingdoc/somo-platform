'use strict';

const kellyRows = [];

jest.mock('../database', () => ({
  db: {
    prepare: (sql) => {
      const s = String(sql);
      if (s.includes('CREATE TABLE')) {
        return { run: jest.fn() };
      }
      if (s.includes('INSERT INTO kelly_conversation_history')) {
        return {
          run: (sessionId, role, content) => {
            kellyRows.push({ session_id: sessionId, role, content });
          }
        };
      }
      if (s.includes('SELECT role, content FROM kelly_conversation_history')) {
        return {
          all: (sessionId, limit) =>
            kellyRows
              .filter((r) => r.session_id === sessionId)
              .slice(0, limit)
              .map((r) => ({ role: r.role, content: r.content }))
        };
      }
      if (s.includes('DELETE FROM kelly_conversation_history')) {
        return { run: jest.fn() };
      }
      return { run: jest.fn(), all: jest.fn(() => []), get: jest.fn() };
    }
  }
}));

jest.mock('../services/kelly-tool-executor', () => ({
  execute: jest.fn().mockResolvedValue({ ok: true })
}));

const KellyToolExecutor = require('../services/kelly-tool-executor');
const {
  appendHistory,
  getLastAssistantText,
  lastAssistantFromMessages,
  seedKellyHistoryFromOrchestrate
} = require('../services/kelly-rails/history');
const { applyOpqrstFieldGate } = require('../services/kelly-rails/execute-turn');
const { formatVoiceReply } = require('../services/voice-reply-formatter');

describe('opqrst-voice-history-wiring', () => {
  const prevGate = process.env.OPQRST_FIELD_GATE_ENABLED;
  const sessionId = 'voice-test-session-1';
  const provAsk = 'What makes it better or worse?';

  beforeEach(() => {
    kellyRows.length = 0;
    KellyToolExecutor.execute.mockClear();
    process.env.OPQRST_FIELD_GATE_ENABLED = '1';
  });

  afterAll(() => {
    process.env.OPQRST_FIELD_GATE_ENABLED = prevGate;
  });

  test('T-7.1 getLastAssistantText returns Kelly table value when populated', () => {
    appendHistory(sessionId, 'assistant', provAsk);
    expect(getLastAssistantText(sessionId, {})).toBe(provAsk);
  });

  test('T-7.2 falls back to orchestrate conversation_history when Kelly empty', () => {
    const mockDb = {
      getOrchestrateSessionBySessionId: () => ({
        conversation_history: [
          { role: 'user', content: 'I have a rash' },
          { role: 'assistant', content: provAsk }
        ]
      })
    };
    expect(getLastAssistantText(sessionId, { db: mockDb })).toBe(provAsk);
  });

  test('lastAssistantFromMessages skips trailing user turn', () => {
    const msgs = [
      { role: 'assistant', content: provAsk },
      { role: 'user', content: 'rest helps' }
    ];
    expect(lastAssistantFromMessages(msgs)).toBe(provAsk);
    expect(lastAssistantFromMessages(msgs.slice(0, -1))).toBe(provAsk);
  });

  test('seedKellyHistoryFromOrchestrate backfills Kelly table once', () => {
    const mockDb = {
      getOrchestrateSessionBySessionId: () => ({
        conversation_history: [
          { role: 'user', content: 'rash on leg' },
          { role: 'assistant', content: 'When did it start?' }
        ]
      })
    };
    expect(seedKellyHistoryFromOrchestrate(sessionId, mockDb)).toBe(true);
    expect(getLastAssistantText(sessionId, {})).toBe('When did it start?');
    expect(seedKellyHistoryFromOrchestrate(sessionId, mockDb)).toBe(false);
  });

  test('seedKellyHistoryFromOrchestrate skips when Kelly already has rows (one-way)', () => {
    appendHistory(sessionId, 'assistant', 'Kelly-owned turn');
    const mockDb = {
      getOrchestrateSessionBySessionId: () => ({
        conversation_history: [
          { role: 'user', content: 'legacy user' },
          { role: 'assistant', content: 'legacy assistant' },
          { role: 'user', content: 'extra legacy user' }
        ]
      })
    };
    expect(seedKellyHistoryFromOrchestrate(sessionId, mockDb)).toBe(false);
    expect(kellyRows.filter((r) => r.session_id === sessionId).length).toBe(1);
  });

  test('getLastAssistantText ignores trailing user turn (post-2.1 single writer)', () => {
    appendHistory(sessionId, 'assistant', provAsk);
    appendHistory(sessionId, 'user', 'rest helps');
    expect(getLastAssistantText(sessionId, {})).toBe(provAsk);
  });

  test('T-7.3 two-turn gate: provocation stored after assistant in history', async () => {
    const triageRow = { onset: '3 days ago', target_specialty: 'Primary Care' };
    let storedProvocation = null;
    const mockDb = {
      getTriageSession: () => ({ ...triageRow, provocation: storedProvocation })
    };

    appendHistory(sessionId, 'assistant', provAsk);

    const state = {
      active_lane: 'clinical',
      conversation_mode: 'tenant_inbound_clinical',
      active_subrail: 'opqrst',
      flags: {},
      locale: 'en'
    };
    const ctx = {
      sessionId,
      message: 'rest helps',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      callerPhone: '+15551234567',
      channel: 'voice'
    };

    KellyToolExecutor.execute.mockImplementation(async (tool, payload) => {
      if (tool === 'store_triage_opqrst' && payload.provocation) {
        storedProvocation = payload.provocation;
      }
      return { ok: true };
    });

    const gate1 = await applyOpqrstFieldGate(state, ctx, mockDb);
    expect(gate1.storePayload?.provocation).toBe('rest helps');
    expect(KellyToolExecutor.execute).toHaveBeenCalledWith(
      'store_triage_opqrst',
      { provocation: 'rest helps' },
      expect.objectContaining({ sessionId })
    );

    appendHistory(sessionId, 'user', 'rest helps');
    appendHistory(sessionId, 'assistant', 'Thanks, noted.');

    storedProvocation = 'rest helps';
    const gate2 = await applyOpqrstFieldGate(
      { ...state, flags: { ...state.flags } },
      { ...ctx, message: 'ok' },
      mockDb
    );
    expect(gate2.openField).not.toBe('provocation');
    expect(gate2.shouldScriptVoice).toBe(false);
  });

  test('T-7.4 formatVoiceReply does not repeat provocation after store', () => {
    const gate = {
      active: true,
      openField: 'quality',
      userAnsweredOpenField: false,
      userAskedTangent: false,
      shouldScriptVoice: false,
      scriptedLine: null,
      opqrstComplete: false
    };
    const out = formatVoiceReply('Thanks, noted.', {
      channel: 'voice',
      active_lane: 'clinical',
      locale: 'en',
      last_user_message: 'ok',
      last_assistant_text: provAsk,
      _opqrst_gate: gate
    });
    expect(out).not.toMatch(/better or worse/i);
    expect(out).toBe('Thanks, noted.');
  });
});
