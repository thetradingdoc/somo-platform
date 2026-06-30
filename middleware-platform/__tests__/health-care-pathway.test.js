'use strict';

const { recommendPathway } = require('../services/health-care-pathway');
const healthVideoOpqrst = require('../services/health-video-opqrst');

describe('health-care-pathway matrix', () => {
  test('chest pain safety flag → emergency', () => {
    const pathway = recommendPathway({
      metadata: {},
      safetyFlags: [{ rule_id: 'chest_pain', level: 'emergent' }]
    });
    expect(pathway.urgency).toBe('emergency');
  });

  test('stroke keywords in safety flags → emergency', () => {
    const pathway = recommendPathway({
      metadata: {},
      safetyFlags: [{ rule_id: 'stroke_signs', match_snippet: 'slurred speech' }]
    });
    expect(pathway.urgency).toBe('emergency');
  });

  test('rash without fever → routine_visit', () => {
    let meta = healthVideoOpqrst.updateFromUtterance({}, 'itchy rash on arm, no fever');
    const pathway = recommendPathway({ metadata: meta, safetyFlags: [] });
    expect(pathway.urgency).toBe('routine_visit');
  });

  test('severe pain → urgent_care', () => {
    let meta = healthVideoOpqrst.updateFromUtterance({}, 'severe unbearable pain 10/10');
    const pathway = recommendPathway({ metadata: meta, safetyFlags: [] });
    expect(pathway.urgency).toBe('urgent_care');
  });
});
