/**
 * Adapted from golden transcript spec (Skin & Care landing persona).
 *
 * - Prompt / phase checks run in normal `npm test`.
 * - Full multi-turn Kelly (live LLM) runs only when:
 *     RUN_KELLY_GOLDEN=1
 *   Expect minutes + API usage; set DEFAULT_CLINIC_ID if your stack requires it.
 *   Jest loads middleware-platform/.env via jest.setup.js — put ANTHROPIC_API_KEY there (or export it).
 *   Prefer Claude: leave KELLY_PRIMARY_PROVIDER unset or `anthropic` (not `groq`).
 *
 *   RUN_KELLY_GOLDEN=1 DEFAULT_CLINIC_ID=... npm test -- kelly-golden-skin-care-transcript --runInBand
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

const KellyAgentService = require('../services/kelly-agent-service');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const {
  resolveOrchestrationPhase,
  KELLY_ORCHESTRATOR_PHASE
} = require('../services/kelly-orchestrator-phase');
const TriageRAGService = require('../services/triage-rag-service');
const db = require('../database');
const KellyPromptBuilder = require('../services/kelly-prompt-builder');

const RUN_GOLDEN = process.env.RUN_KELLY_GOLDEN === '1';

const PERSONA = {
  name: 'Amara',
  description: `
    Woman in her early 30s. No rash, no active breakouts, no medical concerns.
    Was given several free skincare product samples (cleanser, serum, moisturiser)
    but has never followed a structured skincare routine.
    Goal: build a simple daily routine using the samples she already has.
  `.trim()
};

const CONVERSATION = [
  {
    turn: 1,
    label: 'Opening — states goal, mentions samples',
    userMessage:
      'Hi! I got some free skincare samples — a cleanser, a vitamin C serum, and a moisturiser. ' +
      "I've never really had a skincare routine. I just want to figure out how to use these properly.",
    assertResponse: {
      shouldNotContain: [
        'annual visit',
        'annual checkup',
        'route you to',
        'specialist',
        'when did your symptoms start',
        'OPQRST',
        'chief complaint'
      ],
      shouldContainOneOf: [
        'routine',
        'morning',
        'evening',
        'skin type',
        'cleanser',
        'moistur',
        'serum'
      ]
    }
  },
  {
    turn: 2,
    label: 'No rash — clarifies this is a routine question, not a symptom',
    userMessage:
      "I don't have a rash or anything like that. My skin is pretty normal, maybe a little dry in winter. " +
      "I just don't know what order to apply things or when.",
    assertResponse: {
      shouldNotContain: [
        'any other symptoms',
        'any symptoms',
        'when did it start',
        'annual visit',
        'annual checkup',
        'no symptoms on file',
        'routine visit'
      ],
      shouldContainOneOf: [
        'order',
        'step',
        'morning',
        'evening',
        'apply',
        'dry skin',
        'skin type'
      ]
    }
  },
  {
    turn: 3,
    label: 'Describes samples — cleanser, vitamin C serum, moisturiser',
    userMessage:
      'The samples I have are: a gentle foaming cleanser, a vitamin C brightening serum, ' +
      "and a daily moisturiser with SPF. That's it for now.",
    assertResponse: {
      shouldNotContain: ['route to', 'specialist', 'annual checkup', 'do you have any other symptoms'],
      shouldContainOneOf: [
        'cleanser',
        'vitamin C',
        'serum',
        'moisturiser',
        'SPF',
        'sunscreen',
        'order',
        'step',
        'morning',
        'evening'
      ]
    }
  },
  {
    turn: 4,
    label: 'Follow-up — asks about evening routine',
    userMessage: 'Do I need a different routine at night? Should I use the serum at night too?',
    assertResponse: {
      shouldNotContain: [
        'annual visit',
        'annual checkup',
        'route to specialist',
        'what products do you have',
        'what samples',
        'do you have any symptoms'
      ],
      shouldContainOneOf: ['evening', 'night', 'serum', 'vitamin C', 'morning', 'PM', 'AM']
    }
  },
  {
    turn: 5,
    label: 'Wrap — asks if there is anything else she should know',
    userMessage: 'Is there anything else I should know to get started?',
    assertResponse: {
      shouldNotContain: [
        'annual visit',
        'schedule an appointment',
        'book a checkup',
        'route you to the right specialist'
      ],
      shouldContainOneOf: [
        'patch test',
        'sunscreen',
        'SPF',
        'consistent',
        'routine',
        'moisturiser',
        'gentle',
        'start with'
      ]
    }
  }
];

function findForbiddenPhrases(text, phrases) {
  const lower = text.toLowerCase();
  return phrases.filter((p) => lower.includes(p.toLowerCase()));
}

function containsAnyOf(text, phrases) {
  const lower = text.toLowerCase();
  return phrases.some((p) => lower.includes(p.toLowerCase()));
}

function metaTrue(sessionId, key) {
  const v = String(KellyToolExecutor._getSessionMeta(sessionId, key) || '').toLowerCase();
  return v === '1' || v === 'true';
}

function buildProcessTurnParams(sessionId, message) {
  const clinicId = (process.env.DEFAULT_CLINIC_ID || process.env.SMOKE_CLINIC_ID || '').trim() || null;
  return {
    sessionId,
    message,
    channel: 'chat',
    clinicId,
    patientId: null,
    patientName: null,
    patientEmail: null,
    portalSessionId: null,
    preferredLanguage: 'en'
  };
}

function resolvePhaseForSession(sessionId, message, intentBucket = 'unknown') {
  return resolveOrchestrationPhase({
    sessionId,
    message: String(message || ''),
    intentBucket,
    db,
    KellyToolExecutor,
    getLatestRag: (sid) => TriageRAGService.getLatestForSession(sid),
    routineLocked: false
  });
}

// ── Always on: matches golden spec C2 / prompt builder ─────────────────────

describe('Kelly golden spec — ROUTINE_INTAKE prompt (no LLM)', () => {
  test('C2: ROUTINE_INTAKE phase slice word count under ceiling', () => {
    const { buildPhasePrompt } = KellyPromptBuilder;
    const prompt = buildPhasePrompt(KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE, { channel: 'chat' });
    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    const WORD_CEILING = 800;
    expect(wordCount).toBeLessThanOrEqual(WORD_CEILING);
    expect(prompt.length).toBeGreaterThan(200);
  });
});

// ── Live LLM transcript (gated) ───────────────────────────────────────────

(RUN_GOLDEN ? describe : describe.skip)('Kelly — Skin & Care golden transcript (live LLM)', () => {
  let sessionId;
  const transcript = [];

  beforeAll(() => {
    sessionId = `test-skincare-${uuidv4()}`;
    KellyToolExecutor._setSessionMeta(sessionId, 'routine_intake_active', '1');
    // eslint-disable-next-line no-console
    console.log('\n━━━ PERSONA ━━━');
    // eslint-disable-next-line no-console
    console.log(PERSONA.description);
    // eslint-disable-next-line no-console
    console.log(`\nSession ID: ${sessionId}\n`);
  });

  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log('\n━━━ FULL TRANSCRIPT ━━━');
    transcript.forEach(({ turn, label, user, agent }) => {
      // eslint-disable-next-line no-console
      console.log(`\n[Turn ${turn}] ${label}`);
      // eslint-disable-next-line no-console
      console.log(`  USER : ${user}`);
      // eslint-disable-next-line no-console
      console.log(`  KELLY: ${agent}`);
    });
    // eslint-disable-next-line no-console
    console.log('\n━━━ END TRANSCRIPT ━━━\n');
  });

  CONVERSATION.forEach(({ turn, label, userMessage, assertResponse }) => {
    describe(`Turn ${turn} — ${label}`, () => {
      let agentReply;

      beforeAll(async () => {
        const p = buildProcessTurnParams(sessionId, userMessage);
        const result = await KellyAgentService.processTurn(p);
        agentReply = result?.reply ?? '';
        transcript.push({ turn, label, user: userMessage, agent: agentReply });
      });

      it('returns a non-empty reply', () => {
        expect(typeof agentReply).toBe('string');
        expect(agentReply.length).toBeGreaterThan(0);
      });

      if (assertResponse?.shouldNotContain?.length) {
        it('does not contain forbidden clinical / wrong-phase phrases', () => {
          const violations = findForbiddenPhrases(agentReply, assertResponse.shouldNotContain);
          if (violations.length > 0) {
            // eslint-disable-next-line no-console
            console.warn(
              `[GOD-OBJECT DETECTED] Turn ${turn} contained forbidden phrase(s): ${violations.join(', ')}`
            );
          }
          expect(violations).toHaveLength(0);
        });
      }

      if (assertResponse?.shouldContainOneOf?.length) {
        it('contains at least one expected routine-context phrase', () => {
          const found = containsAnyOf(agentReply, assertResponse.shouldContainOneOf);
          if (!found) {
            // eslint-disable-next-line no-console
            console.warn(
              `[OFF-TOPIC] Turn ${turn} did not contain any of: ${assertResponse.shouldContainOneOf.join(', ')}`
            );
          }
          expect(found).toBe(true);
        });
      }

      // Must run in the same describe as turn 1 (immediately after first processTurn), not after turn 5.
      if (turn === 1) {
        describe('Phase A — Entry & activation (right after turn 1)', () => {
          it('A1: routine_intake_active still set after first reply', () => {
            expect(metaTrue(sessionId, 'routine_intake_active')).toBe(true);
          });

          it('A2: resolved phase is ROUTINE_INTAKE for turn-1 message context', () => {
            const phaseResult = resolvePhaseForSession(sessionId, CONVERSATION[0].userMessage);
            expect(phaseResult.phase).toBe(KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE);
          });
        });
      }
    });
  });

  describe('Phase E — routine_no_symptoms guard', () => {
    it('E2: "no symptoms" does not trigger annual-checkup framing after concern on file', async () => {
      const p = buildProcessTurnParams(
        sessionId,
        "I don't have any symptoms, I just want skincare help."
      );
      const result = await KellyAgentService.processTurn(p);
      const reply = result?.reply ?? '';
      const annualVisitPhrases = [
        'annual visit',
        'annual checkup',
        'routine checkup',
        'no symptoms on file',
        'schedule a visit',
        'book an appointment',
        'routine visit with no symptoms'
      ];
      const violations = findForbiddenPhrases(reply, annualVisitPhrases);
      if (violations.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ANNUAL-VISIT PIVOT DETECTED] Found: ${violations.join(', ')}`
        );
      }
      expect(violations).toHaveLength(0);
    });
  });

  describe('Data capture — no repeated questions (turns 4–5)', () => {
    it('products not re-asked in later turns', () => {
      const laterTurns = transcript.filter((t) => t.turn >= 4);
      laterTurns.forEach(({ turn, agent }) => {
        const reAsked = findForbiddenPhrases(agent, [
          'what products do you have',
          'what samples do you have',
          'could you tell me what products',
          'what skincare products'
        ]);
        if (reAsked.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(`[RE-ASK DETECTED] Turn ${turn}: ${reAsked.join(', ')}`);
        }
        expect(reAsked).toHaveLength(0);
      });
    });
  });
});
