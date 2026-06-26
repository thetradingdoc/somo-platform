'use strict';

jest.mock('../services/layer2-rag/patient-education-client', () => ({
  retrievePatientEducationPassages: jest.fn()
}));

jest.mock('../services/derm-patient-qa-pipeline', () => ({
  runDermPatientQAPipeline: jest.fn()
}));

const { retrievePatientEducationPassages } = require('../services/layer2-rag/patient-education-client');
const { runDermPatientQAPipeline } = require('../services/derm-patient-qa-pipeline');
const { retrieveForHealth, clearSessionCache } = require('../services/health-education-retriever');
const videoToolRegistry = require('../services/video-tool-registry');
const healthSessionService = require('../services/health-session-service');

describe('health-education-retriever', () => {
  beforeEach(() => {
    clearSessionCache('sess-1');
    retrievePatientEducationPassages.mockReset();
  });

  test('retrieveForHealth returns passages from patient education client', async () => {
    retrievePatientEducationPassages.mockResolvedValue({
      passages: [{ title: 'Eczema care', source: 'derm-education-v1' }],
      metadata: { corpus_version: 'derm-education-v1' }
    });

    const result = await retrieveForHealth({
      query: 'itchy rash on arm',
      sessionId: 'sess-1',
      opqrstMeta: { opqrst: { R: 'arm' } }
    });

    expect(retrievePatientEducationPassages).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('itchy rash on arm'),
        specialty: 'dermatology',
        corpus_version: 'derm-education-v1'
      })
    );
    expect(result.passages).toHaveLength(1);
    expect(result.cached).toBe(false);
  });

  test('retrieveForHealth uses session cache on repeat query', async () => {
    retrievePatientEducationPassages.mockResolvedValue({
      passages: [{ title: 'Hives' }],
      metadata: {}
    });

    const first = await retrieveForHealth({ query: 'hives', sessionId: 'sess-1' });
    const second = await retrieveForHealth({ query: 'hives', sessionId: 'sess-1' });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(retrievePatientEducationPassages).toHaveBeenCalledTimes(1);
  });
});

describe('video-tool-registry analyze_skin_concern RAG path', () => {
  const prev = process.env.DERM_EDUCATION_PIPELINE_ENABLED;

  beforeAll(() => {
    process.env.DERM_EDUCATION_PIPELINE_ENABLED = 'true';
  });

  afterAll(() => {
    process.env.DERM_EDUCATION_PIPELINE_ENABLED = prev;
  });

  beforeEach(() => {
    runDermPatientQAPipeline.mockReset();
    runDermPatientQAPipeline.mockResolvedValue({
      success: true,
      answer_text: 'Mild rashes often improve with gentle skin care.',
      compose: {
        citations_for_ui: ['AAD: Rash basics'],
        abstain_reason: null
      }
    });
  });

  test('returns citations when derm pipeline succeeds', async () => {
    const session = healthSessionService.createSession({ termsAccepted: true });
    const out = await videoToolRegistry.executeTool(
      'analyze_skin_concern',
      { message: 'red itchy patch on my arm' },
      { sessionId: session.id, roomId: session.room_id }
    );

    expect(out.success).toBe(true);
    expect(out.citations).toContain('AAD: Rash basics');
    expect(out.answer).toMatch(/rash/i);
  });
});
