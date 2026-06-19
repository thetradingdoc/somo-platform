'use strict';

const OpqrstFieldGate = require('../services/opqrst-field-gate');

const BASE = {
  activeLane: 'clinical',
  conversationMode: 'tenant_inbound_clinical',
  activeSubrail: 'opqrst',
  triagePolicy: 'conditional',
  locale: 'en'
};

function resolve(overrides = {}) {
  return OpqrstFieldGate.resolve({ ...BASE, ...overrides });
}

describe('opqrst-field-gate', () => {
  const prev = process.env.OPQRST_FIELD_GATE_ENABLED;

  beforeAll(() => {
    process.env.OPQRST_FIELD_GATE_ENABLED = '1';
  });

  afterAll(() => {
    process.env.OPQRST_FIELD_GATE_ENABLED = prev;
  });

  describe('T-1 core', () => {
    test('rest helps stores provocation when assistant asked provocation', () => {
      const r = resolve({
        triageRow: { onset: '2 days ago' },
        userMessage: 'rest helps',
        lastAssistantText: 'What makes it better or worse?'
      });
      expect(r.active).toBe(true);
      expect(r.openField).toBe('provocation');
      expect(r.storePayload).toEqual({ provocation: 'rest helps' });
      expect(r.allowStoreOpqrst).toBe(true);
    });

    test('meta question is tangent without store', () => {
      const r = resolve({
        triageRow: { onset: 'yesterday' },
        userMessage: 'Why do you need that?',
        lastAssistantText: 'What makes it better or worse?'
      });
      expect(r.userAskedTangent).toBe(true);
      expect(r.storePayload).toBeNull();
      expect(r.shouldScriptVoice).toBe(false);
    });

    test('no script when opqrst complete', () => {
      const r = resolve({
        triageRow: {
          onset: '2 days',
          quality: 'sharp',
          severity: 5,
          timing: 'constant',
          provocation: 'rest',
          radiation: 'none'
        },
        userMessage: 'ok',
        lastAssistantText: 'What makes it better or worse?'
      });
      expect(r.opqrstComplete).toBe(true);
      expect(r.shouldScriptVoice).toBe(false);
    });

    test('inactive outside clinical lane', () => {
      const r = resolve({
        activeLane: 'booking',
        triageRow: { onset: 'today' },
        userMessage: 'rest helps',
        lastAssistantText: 'What makes it better or worse?'
      });
      expect(r.active).toBe(false);
    });
  });

  describe('T-1b ambiguous utterances', () => {
    const provRow = { onset: '3 days ago' };
    const provAsk = 'What makes it better or worse?';

    test('case 1: walking worse stores provocation', () => {
      const r = resolve({
        triageRow: provRow,
        userMessage: 'Walking makes it worse',
        lastAssistantText: provAsk
      });
      expect(r.storePayload?.provocation).toMatch(/walking/i);
    });

    test('case 2: uncertain answer stores', () => {
      const r = resolve({
        triageRow: provRow,
        userMessage: "I don't know, maybe when I sit down?",
        lastAssistantText: provAsk
      });
      expect(r.storePayload?.provocation).toBeTruthy();
    });

    test('case 3: insurance question is tangent', () => {
      const r = resolve({
        triageRow: provRow,
        userMessage: 'Does insurance cover this?',
        lastAssistantText: provAsk
      });
      expect(r.userAskedTangent).toBe(true);
      expect(r.storePayload).toBeNull();
    });

    test('case 4: hurts when walk stores', () => {
      const r = resolve({
        triageRow: provRow,
        userMessage: 'It hurts when I walk, is that bad?',
        lastAssistantText: provAsk
      });
      expect(r.storePayload?.provocation).toBeTruthy();
    });

    test('case 5: nothing really stores', () => {
      const r = resolve({
        triageRow: provRow,
        userMessage: 'Nothing really',
        lastAssistantText: provAsk
      });
      expect(r.storePayload?.provocation).toMatch(/nothing really/i);
    });

    test('case 6: booking intent is tangent', () => {
      const r = resolve({
        triageRow: provRow,
        userMessage: 'Can I book after this?',
        lastAssistantText: provAsk
      });
      expect(r.userAskedTangent).toBe(true);
    });

    test('case 7: What? is tangent', () => {
      const r = resolve({
        triageRow: provRow,
        userMessage: 'What?',
        lastAssistantText: provAsk
      });
      expect(r.userAskedTangent).toBe(true);
    });

    test('case 8: sitting helps stores', () => {
      const r = resolve({
        triageRow: provRow,
        userMessage: 'Sitting helps, standing is worse',
        lastAssistantText: provAsk
      });
      expect(r.storePayload?.provocation).toBeTruthy();
    });

    test('case 9: pay copay tangent preserves resume field', () => {
      const r = resolve({
        triageRow: provRow,
        userMessage: 'Pay my copay first',
        lastAssistantText: provAsk
      });
      expect(r.userAskedTangent).toBe(true);
      expect(r.resumeFieldAfterTangent).toBe('provocation');
    });

    test('case 10: empty utterance no store', () => {
      const r = resolve({
        triageRow: provRow,
        userMessage: 'uh-huh',
        lastAssistantText: provAsk
      });
      expect(r.storePayload).toBeNull();
      expect(r.shouldScriptVoice).toBe(false);
    });
  });

  describe('opqrstComplete policy', () => {
    test('provocation optional under conditional policy', () => {
      const complete = OpqrstFieldGate.opqrstComplete({
        onset: '1d',
        quality: 'burning',
        severity: 6,
        timing: 'constant'
      });
      expect(complete).toBe(true);
    });

    test('provocation required when triage_policy required', () => {
      const incomplete = OpqrstFieldGate.opqrstComplete(
        { onset: '1d', quality: 'burning', severity: 6, timing: 'constant' },
        { triagePolicy: 'required' }
      );
      expect(incomplete).toBe(false);
    });
  });
});
