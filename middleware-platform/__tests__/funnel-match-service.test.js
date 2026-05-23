const { match } = require('../services/funnel-match-service');

describe('funnel-match-service', () => {
  test('L1 cystic acne → program acne', () => {
    const out = match({ inquiry: 'cystic acne purging', user_goal: 'track_program' });
    expect(out.route).toBe('program');
    expect(out.concern_id).toBe('acne');
  });

  test('L1 dark spots → hyperpigmentation', () => {
    const out = match({ inquiry: 'dark spots after breakouts', user_goal: 'track_program' });
    expect(out.route).toBe('program');
    expect(out.concern_id).toBe('hyperpigmentation');
  });

  test('L1 redness → rosacea', () => {
    const out = match({ inquiry: "redness that won't go away", user_goal: 'track_program' });
    expect(out.route).toBe('program');
    expect(out.concern_id).toBe('rosacea');
  });

  test('anti_aging lines chip routes to anti_aging program under track_program', () => {
    const out = match({
      inquiry: 'fine lines and wrinkles',
      concern_chip: 'anti_aging',
      user_goal: 'track_program',
    });
    expect(out.route).toBe('program');
    expect(out.concern_id).toBe('anti_aging');
    expect(out.user_goal).toBe('track_program');
  });

  test('legacy anti_aging user_goal normalizes to track_program', () => {
    const out = match({ inquiry: 'fine lines', user_goal: 'anti_aging' });
    expect(out.user_goal).toBe('track_program');
  });

  test('L1 barrier → barrier_repair', () => {
    const out = match({ inquiry: 'skin feels tight and raw', user_goal: 'track_program' });
    expect(out.route).toBe('program');
    expect(out.concern_id).toBe('barrier_repair');
  });

  test('L0 mole changed → specialist never program', () => {
    const out = match({ inquiry: 'mole changed color last month', user_goal: 'track_program' });
    expect(out.route).toBe('specialist');
    expect(out.layer).toBe('L0');
    expect(out.concern_id).toBeNull();
  });

  test('growth on stomach → specialist escalation', () => {
    const out = match({ inquiry: 'growth on stomach', user_goal: 'track_program' });
    expect(out.route).toBe('specialist');
    expect(out.rationale).toMatch(/escalation/);
  });

  test('vague rash → clarify with next_questions', () => {
    const out = match({ inquiry: 'rash 10 days', user_goal: 'track_program' });
    expect(out.route).toBe('clarify');
    expect(Array.isArray(out.next_questions)).toBe(true);
    expect(out.next_questions.length).toBeGreaterThan(0);
  });

  test('clarify spreading → specialist', () => {
    const out = match({
      inquiry: 'rash on chest',
      user_goal: 'track_program',
      clarify_answers: { location: 'body', changing: 'spreading' },
    });
    expect(out.route).toBe('specialist');
    expect(out.rationale).toMatch(/clarify/);
  });

  test('find_specialist goal → specialist without program', () => {
    const out = match({ inquiry: 'cystic acne', user_goal: 'find_specialist', zip: '10001' });
    expect(out.route).toBe('specialist');
    expect(out.concern_id).toBeNull();
    expect(out.rationale).toBe('find_specialist_goal');
  });

  test('both goal → dual with companion', () => {
    const out = match({ inquiry: 'cystic acne', user_goal: 'both', zip: '10001' });
    expect(out.route).toBe('dual');
    expect(out.concern_id).toBe('acne');
    expect(out.companion_concern_id).toBe('acne');
    expect(out.specialist_query?.zip).toBe('10001');
  });

  test('L0 chest pain → specialist', () => {
    const out = match({ inquiry: 'chest pain and a rash', user_goal: 'track_program' });
    expect(out.route).toBe('specialist');
    expect(out.layer).toBe('L0');
  });

  test('weeping sores → specialist via catalog or escalation', () => {
    const out = match({ inquiry: 'weeping sores on face', user_goal: 'track_program' });
    expect(out.route).toBe('specialist');
  });

  test('hair loss → specialist out of scope', () => {
    const out = match({ inquiry: 'hair loss and breakouts', user_goal: 'track_program' });
    expect(out.route).toBe('specialist');
    expect(out.rationale).toBe('out_of_scope');
  });

  test('not sure without chip → clarify not barrier_repair', () => {
    const out = match({ inquiry: 'not sure, just started noticing things', user_goal: 'track_program' });
    expect(out.route).toBe('clarify');
    expect(out.concern_id).toBeNull();
  });

  test('explicit chip overrides ambiguous text', () => {
    const out = match({ inquiry: 'something vague', concern_chip: 'acne', user_goal: 'track_program' });
    expect(out.route).toBe('program');
    expect(out.concern_id).toBe('acne');
    expect(out.confidence).toBeGreaterThanOrEqual(0.85);
  });

  test('L0 never returns program', () => {
    const emergencies = ['mole changed color', 'chest pain and shortness of breath', 'cannot breathe'];
    for (const inquiry of emergencies) {
      const out = match({ inquiry, user_goal: 'track_program' });
      expect(out.route).not.toBe('program');
    }
  });

  test('face_read note on program without route change', () => {
    const out = match({
      inquiry: 'cystic acne',
      concern_chip: 'acne',
      user_goal: 'track_program',
      face_read: { apparent_age_estimate: 40, quality: 'ok' },
      confirmed_age: 29,
    });
    expect(out.route).toBe('program');
    expect(out.face_read_note).toMatch(/photo suggested/i);
  });

  test('returns scores and alternatives on program match', () => {
    const out = match({ inquiry: 'cystic acne purging', user_goal: 'track_program' });
    expect(Array.isArray(out.scores)).toBe(true);
    expect(out.scores.length).toBeGreaterThan(0);
  });

  test('unmapped text on track_program → clarify not specialist', () => {
    const out = match({ inquiry: 'idk my skin feels weird', user_goal: 'track_program' });
    expect(out.route).toBe('clarify');
    expect(out.next_questions?.length).toBeGreaterThan(0);
  });

  test('track_program ignores zip in specialist_query paths', () => {
    const out = match({
      inquiry: 'cystic acne',
      user_goal: 'track_program',
      zip: '10469',
    });
    expect(out.route).toBe('program');
    expect(out.specialist_query).toBeNull();
  });

  test('find_specialist uses physician_specialist scope', () => {
    const out = match({ inquiry: '', user_goal: 'find_specialist', zip: '10001' });
    expect(out.specialist_query?.scope).toBe('physician_specialist');
  });
});
