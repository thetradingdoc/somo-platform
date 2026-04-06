/**
 * @jest-environment node
 */
process.env.NODE_ENV = 'test';

const { isDermEducationPipelineEnabled, runDermPatientQAPipeline } = require('../services/derm-patient-qa-pipeline');

describe('derm-patient-qa-pipeline', () => {
  const OLD = process.env.DERM_EDUCATION_PIPELINE_ENABLED;
  const OLD_SKIP = process.env.DERM_QA_SKIP_LLM;

  afterEach(() => {
    process.env.DERM_EDUCATION_PIPELINE_ENABLED = OLD;
    process.env.DERM_QA_SKIP_LLM = OLD_SKIP;
  });

  test('isDermEducationPipelineEnabled false by default in test env', () => {
    process.env.DERM_EDUCATION_PIPELINE_ENABLED = 'false';
    expect(isDermEducationPipelineEnabled()).toBe(false);
  });

  test('isDermEducationPipelineEnabled true when set', () => {
    process.env.DERM_EDUCATION_PIPELINE_ENABLED = 'true';
    expect(isDermEducationPipelineEnabled()).toBe(true);
  });

  test('runDermPatientQAPipeline returns disabled when flag off', async () => {
    process.env.DERM_EDUCATION_PIPELINE_ENABLED = 'false';
    const out = await runDermPatientQAPipeline({ message: 'test' });
    expect(out.success).toBe(false);
    expect(out.error).toBe('derm_education_pipeline_disabled');
  });

  test('runDermPatientQAPipeline returns compose without LLM when skip_llm', async () => {
    process.env.DERM_EDUCATION_PIPELINE_ENABLED = 'true';
    process.env.DERM_QA_SKIP_LLM = 'true';
    const out = await runDermPatientQAPipeline({
      message: 'Please help me with my skin',
      skip_llm: true
    });
    expect(out.success).toBe(true);
    expect(out.skip_llm).toBe(true);
    expect(out.compose).toBeDefined();
    expect(out.answer_text).toBeNull();
  });
});
