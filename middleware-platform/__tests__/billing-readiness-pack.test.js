'use strict';

const { buildBillingReadinessPack } = require('../services/billing-readiness-pack');

describe('billing-readiness-pack', () => {
  test('builds candidate pack with confidence and refs', () => {
    const pack = buildBillingReadinessPack({
      source: 'video_consult',
      room_id: 'room-1',
      rag_context: {
        icd10: [{ code: 'L30.9', description: 'Dermatitis, unspecified' }],
        cpt: [{ code: '99213', description: 'Office visit' }],
        hcpcs: []
      },
      confidence: 0.72,
      records: { success: true },
      literature: { success: true },
      vision_tags: [{ finding: 'Possible wound' }]
    });
    expect(pack.icd10_candidates.length).toBe(1);
    expect(pack.cpt_candidates.length).toBe(1);
    expect(pack.confidence).toBeCloseTo(0.72, 5);
    expect(Array.isArray(pack.supporting_evidence_refs)).toBe(true);
    expect(pack.audit.source).toBe('video_consult');
    expect(pack.audit.room_id).toBe('room-1');
  });
});
