/**
 * @jest-environment node
 */
process.env.NODE_ENV = 'test';

const { applyLayClinicalExpansion, shouldSkipHyde } = require('../services/layer2-rag/patient-education-query');
const {
  rerankPassagesByLexicalOverlap,
  rerankPassagesWithContentPolicy
} = require('../services/layer2-rag/patient-education-passage-rerank');
const { resetCircuitBreakersForTests } = require('../utils/circuit-breaker');
const {
  mergeQueryForSingleBackend,
  retrievePatientEducationForDermQA
} = require('../services/layer2-rag/patient-education-client');

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}));

const axios = require('axios');

describe('patient-education-query', () => {
  test('applyLayClinicalExpansion adds tretinoin for tret', () => {
    const out = applyLayClinicalExpansion('Month 3 on tret still purging');
    expect(out.addedTerms.join(' ')).toMatch(/tretinoin/i);
    expect(out.query).toContain('Related terms');
  });

  test('shouldSkipHyde for short message', () => {
    expect(shouldSkipHyde('help', {})).toBe(true);
    const longEnough =
      'I have a question about my tretinoin routine and peeling that has lasted several weeks now';
    expect(shouldSkipHyde(longEnough, {})).toBe(false);
  });

  test('applyLayClinicalExpansion leaves query unchanged when no expansion pairs match', () => {
    const q = 'The quick brown fox jumps over the lazy dog.';
    const out = applyLayClinicalExpansion(q);
    expect(out.query).toBe(q);
    expect(out.addedTerms).toEqual([]);
  });
});

describe('patient-education-passage-rerank', () => {
  test('boosts passage overlapping query terms', () => {
    const passages = [
      { text: 'weather forecast tomorrow', score: 0.1 },
      { text: 'tretinoin peeling skin dryness in first weeks', score: 0.5 }
    ];
    const out = rerankPassagesByLexicalOverlap(passages, 'tretinoin peeling skin', 1);
    expect(out[0].text).toContain('tretinoin');
  });

  test('rerankPassagesWithContentPolicy sets all_filtered_spam when every passage is spam', () => {
    const passages = [
      { text: 'Limited time offer click here for miracle cure overnight', score: 0.9 },
      { text: 'buy now #1 dermatologist seo services', score: 0.8 }
    ];
    const res = rerankPassagesWithContentPolicy(passages, 'acne', 5);
    expect(res.passages).toEqual([]);
    expect(res.dropped_spam).toBe(2);
    expect(res.all_filtered_spam).toBe(true);
  });
});

describe('patient-education-client helpers', () => {
  test('mergeQueryForSingleBackend concatenates hybrid parts', () => {
    const q = mergeQueryForSingleBackend('base', {
      dense_query: 'dense line',
      bm25_terms: ['foo', 'bar']
    });
    expect(q).toContain('base');
    expect(q).toContain('dense');
    expect(q).toContain('foo');
  });

  test('mergeQueryForSingleBackend returns base when bm25_terms empty and no dense_query', () => {
    expect(mergeQueryForSingleBackend('patient question only', { dense_query: '', bm25_terms: [] })).toBe(
      'patient question only'
    );
  });

  test('mergeQueryForSingleBackend still merges dense_query when bm25_terms empty', () => {
    const q = mergeQueryForSingleBackend('patient question', {
      dense_query: 'clinical paraphrase',
      bm25_terms: []
    });
    expect(q).toContain('patient question');
    expect(q).toContain('clinical paraphrase');
  });

  test('retrievePatientEducationForDermQA skips when policy is none', async () => {
    const out = await retrievePatientEducationForDermQA({
      message: 'anything',
      retrieval_policy: { passage_retrieval: 'none', top_k: 0 }
    });
    expect(out.skipped).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('retrievePatientEducationPassages (mocked axios)', () => {
  const OLD_EDU = process.env.RAG_EDUCATION_URL;
  const OLD_RAG = process.env.RAG_API_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAG_EDUCATION_URL = '';
    process.env.RAG_API_URL = 'http://test.local/api/rag';
    axios.post.mockResolvedValue({
      data: {
        passages: [{ id: '1', text: 'acne guidance', score: 0.8, source_id: 's1' }],
        metadata: { version: 't' }
      }
    });
  });

  afterEach(() => {
    process.env.RAG_EDUCATION_URL = OLD_EDU;
    process.env.RAG_API_URL = OLD_RAG;
  });

  test('POSTs to /retrieve_passages', async () => {
    const { retrievePatientEducationPassages } = require('../services/layer2-rag/patient-education-client');
    const out = await retrievePatientEducationPassages({
      query: 'acne routine',
      top_k: 5,
      specialty: 'dermatology'
    });
    expect(out.passages.length).toBe(1);
    expect(axios.post).toHaveBeenCalledWith(
      'http://test.local/api/rag/retrieve_passages',
      expect.objectContaining({ query: 'acne routine', top_k: 5 }),
      expect.any(Object)
    );
  });
});

describe('patient-education circuit breaker (uses axios mock)', () => {
  const OLD_EDU = process.env.RAG_EDUCATION_URL;
  const OLD_RAG = process.env.RAG_API_URL;
  const OLD_THRESH = process.env.RAG_EDUCATION_CIRCUIT_FAILURE_THRESHOLD;

  beforeEach(() => {
    resetCircuitBreakersForTests();
    jest.clearAllMocks();
    process.env.RAG_EDUCATION_URL = '';
    process.env.RAG_API_URL = 'http://circuit-test.local/api/rag';
    process.env.RAG_EDUCATION_CIRCUIT_FAILURE_THRESHOLD = '1';
    axios.post.mockRejectedValue(new Error('network down'));
  });

  afterEach(() => {
    process.env.RAG_EDUCATION_URL = OLD_EDU;
    process.env.RAG_API_URL = OLD_RAG;
    process.env.RAG_EDUCATION_CIRCUIT_FAILURE_THRESHOLD = OLD_THRESH;
    resetCircuitBreakersForTests();
  });

  test('open circuit skips axios and returns null via fallback', async () => {
    const { retrievePatientEducationPassages } = require('../services/layer2-rag/patient-education-client');
    const first = await retrievePatientEducationPassages({ query: 'q1', top_k: 3 });
    expect(first).toBeNull();

    const callsAfterFirstFailure = axios.post.mock.calls.length;
    const second = await retrievePatientEducationPassages({ query: 'q2', top_k: 3 });
    expect(second).toBeNull();
    expect(axios.post.mock.calls.length).toBe(callsAfterFirstFailure);
  });
});
