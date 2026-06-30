'use strict';

const { composeFromParts } = require('../services/derm-patient-qa-answer');

describe('derm weak-RAG abstain', () => {
  test('zero passages with education intent abstains', () => {
    const out = composeFromParts({
      triage: { intent: 'education', needs_clarification: false },
      message: 'red itchy rash on neck',
      retrieval: { passages: [], skipped: false, metadata: {} }
    });
    expect(out.mode).toBe('abstain');
    expect(out.abstain_reason).toBe('no_passages');
  });
});
