const { runClinicalTriage, enrichInquiryForMatch } = require('../services/funnel-clinical-triage');
const { match } = require('../services/funnel-match-service');

describe('funnel-clinical-triage', () => {
  test('melanoma wording → specialist', () => {
    const out = runClinicalTriage({
      inquiry: '43M does this look like acral melanoma?',
      user_goal: 'track_program',
    });
    expect(out.action).toBe('specialist');
    expect(out.rationale).toMatch(/urgent|diagnosis/);
  });

  test('tretinoin purging → continue with enrichment', () => {
    const inquiry = 'tretinoin purging month 3 flaky';
    const out = runClinicalTriage({
      inquiry,
      user_goal: 'track_program',
    });
    expect(out.action).toBe('continue');
    expect(out.enriched_inquiry.length).toBeGreaterThan(inquiry.length);
  });

  test('diagnosis-only without chip → specialist', () => {
    const out = runClinicalTriage({
      inquiry: 'what is on my arm',
      user_goal: 'track_program',
    });
    expect(out.action).toBe('specialist');
  });

  test('on_prescription clarify yes → specialist', () => {
    const out = runClinicalTriage({
      inquiry: 'dry skin',
      clarify_answers: { on_prescription: 'yes', duration: 'weeks' },
      user_goal: 'track_program',
    });
    expect(out.action).toBe('specialist');
    expect(out.rationale).toMatch(/prescription/);
  });

  test('enrichInquiryForMatch adds tokens for routine intent', () => {
    const enriched = enrichInquiryForMatch('using adapalene', {
      intent: 'routine',
      subkind: 'product_routine',
    });
    expect(enriched).toMatch(/retinoid|skincare/i);
  });
});

describe('funnel-match-service clinical integration', () => {
  test('melanoma via match → specialist clinical layer', () => {
    const out = match({
      inquiry: 'does this look like melanoma on my back',
      user_goal: 'track_program',
    });
    expect(out.route).toBe('specialist');
    expect(['clinical', 'L0']).toContain(out.layer);
  });

  test('tretinoin purging → program acne', () => {
    const out = match({
      inquiry: 'cystic acne tretinoin purging month 3 flaky',
      user_goal: 'track_program',
    });
    expect(out.route).toBe('program');
    expect(out.concern_id).toBe('acne');
  });

  test('what is on my arm → specialist', () => {
    const out = match({ inquiry: 'what is on my arm', user_goal: 'track_program' });
    expect(out.route).toBe('specialist');
  });

  test('clarify on_prescription yes → specialist', () => {
    const out = match({
      inquiry: 'rash on face',
      user_goal: 'track_program',
      clarify_answers: {
        duration: 'weeks',
        on_prescription: 'yes',
        location: 'face',
        changing: 'stable',
      },
    });
    expect(out.route).toBe('specialist');
    expect(out.rationale).toMatch(/prescription/);
  });

  test('empty inquiry not sure path → clarify with questions', () => {
    const out = match({ inquiry: '', user_goal: 'track_program' });
    expect(out.route).toBe('clarify');
    expect(out.next_questions?.some((q) => q.id === 'on_prescription')).toBe(true);
  });
});
