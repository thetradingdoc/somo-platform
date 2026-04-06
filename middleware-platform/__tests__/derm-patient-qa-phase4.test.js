/**
 * @jest-environment node
 */
process.env.NODE_ENV = 'test';

const { assessPassageGrounding, passageGroundingScore } = require('../services/derm-patient-qa-grounding');
const { buildCitationList } = require('../services/derm-patient-qa-citations');
const { composeFromParts } = require('../services/derm-patient-qa-answer');
const { isLikelySeoSpam, rerankPassagesWithContentPolicy } = require('../services/layer2-rag/patient-education-passage-rerank');

describe('grounding', () => {
  test('high overlap when passage matches query topic', () => {
    const s = passageGroundingScore('Is tretinoin purging normal at week 8', 'Tretinoin can cause an initial worsening called purging');
    expect(s).toBeGreaterThan(0.2);
  });

  test('abstain when passages are about a different topic', () => {
    const g = assessPassageGrounding({
      query: 'How do I treat eczema on my hands',
      passages: [{ text: 'Acne vulgaris is treated with benzoyl peroxide and topical retinoids for comedones.' }],
      minBestScore: 0.2
    });
    expect(g.should_abstain).toBe(true);
  });
});

describe('citations', () => {
  test('buildCitationList exposes labels for UI', () => {
    const list = buildCitationList(
      [{ id: 'c1', source_id: 'g1', source_title: 'AAD', text: 'x'.repeat(200) }],
      { debug: false }
    );
    expect(list[0].label).toMatch(/AAD/);
    expect(list[0].text_preview).toBeUndefined();
  });
});

describe('content policy rerank', () => {
  test('isLikelySeoSpam detects clickbait', () => {
    expect(isLikelySeoSpam('Click here for miracle cure guaranteed results overnight')).toBe(true);
  });

  test('drops spam then ranks remainder', () => {
    const { passages, all_filtered_spam } = rerankPassagesWithContentPolicy(
      [
        { text: 'click here for miracle cure', score: 0.99 },
        { text: 'Eczema moisturizers and barrier repair', score: 0.4 }
      ],
      'eczema treatment hands',
      5
    );
    expect(all_filtered_spam).toBe(false);
    expect(passages[0].text).toContain('Eczema');
  });
});

describe('composeFromParts', () => {
  test('clarify_only when triage requests clarification', () => {
    const out = composeFromParts({
      triage: { needs_clarification: true, intent: 'education', subkind: 'pending_clarification' },
      message: 'help',
      retrieval: { passages: [], skipped: true, metadata: {} },
      retrievalFacingText: 'help'
    });
    expect(out.mode).toBe('clarify_only');
  });

  test('abstain on evidence mismatch', () => {
    const out = composeFromParts({
      triage: { needs_clarification: false, intent: 'education', subkind: 'general_education' },
      message: 'severe hand eczema ointments',
      retrieval: {
        passages: [{ text: 'Acne treatment with salicylic acid peels for comedonal acne only.' }],
        skipped: false,
        metadata: {}
      },
      retrievalFacingText: 'severe hand eczema ointments'
    });
    expect(out.mode).toBe('abstain');
    expect(out.abstain_reason).toBe('evidence_mismatch');
  });
});
