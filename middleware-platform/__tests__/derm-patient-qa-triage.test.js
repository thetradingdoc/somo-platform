/**
 * @jest-environment node
 */
process.env.NODE_ENV = 'test';

const { classifyDermPatientQA } = require('../services/derm-patient-qa-triage');

describe('classifyDermPatientQA', () => {
  test('systemic chest pain → urgent systemic, minimal retrieval', () => {
    const out = classifyDermPatientQA({ message: 'I have crushing chest pain and shortness of breath' });
    expect(out.intent).toBe('urgent');
    expect(out.subkind).toBe('systemic_emergency');
    expect(out.retrieval_policy.passage_retrieval).toBe('minimal');
    expect(out.retrieval_policy.scheduling_allowed).toBe(false);
  });

  test('melanoma wording → derm urgent', () => {
    const out = classifyDermPatientQA({ message: 'My mole changed color and looks like melanoma' });
    expect(out.intent).toBe('urgent');
    expect(out.subkind).toBe('derm_skin_urgent');
    expect(out.retrieval_policy.short_circuit_long_answer).toBe(true);
  });

  test('please help me (short) → needs clarification, no passage retrieval', () => {
    const out = classifyDermPatientQA({ message: 'Please help me' });
    expect(out.needs_clarification).toBe(true);
    expect(out.retrieval_policy.passage_retrieval).toBe('none');
    expect(out.retrieval_policy.top_k).toBe(0);
  });

  test('tretinoin purging → routine', () => {
    const out = classifyDermPatientQA({ message: 'Month 3 tretinoin purging is this normal' });
    expect(out.intent).toBe('routine');
    expect(out.retrieval_policy.passage_retrieval).toBe('full');
  });

  test('off-topic shipping', () => {
    const out = classifyDermPatientQA({ message: 'how long does preparing to ship on yesstyle take' });
    expect(out.intent).toBe('off_topic');
    expect(out.retrieval_policy.top_k).toBe(0);
  });

  test('structured intake merged with message for derm rules', () => {
    const out = classifyDermPatientQA({
      message: 'see attached',
      structuredIntake: { description: 'mole changed color melanoma concern' }
    });
    expect(out.intent).toBe('urgent');
    expect(out.subkind).toBe('derm_skin_urgent');
  });
});
