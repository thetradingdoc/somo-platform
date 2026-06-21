'use strict';

/**
 * Kelly collect_insurance must POST to HTTP without client service_code
 * (HTTP resolveInsuranceCodes rejects client-supplied service_code).
 */

const KellyToolExecutor = require('../services/kelly-tool-executor');
const TriageRAGService = require('../services/triage-rag-service');

jest.mock('../services/resolve-insurance-codes', () => ({
  resolveInsuranceCodes: jest.fn()
}));

jest.mock('../services/payer-quote-service', () => ({
  computeVisitQuote: jest.fn(async () => ({
    status: 'hard_number',
    copay_due_now: 35,
    primary_icd10: 'K29.70',
    primary_cpt: '99213'
  }))
}));

jest.mock('../database', () => ({
  getTriageSession: jest.fn(),
  insertKellyCallEvent: jest.fn(),
  getOrchestrateSessionBySessionId: jest.fn(),
  incrementOpsCounter: jest.fn()
}));

jest.mock('../services/triage-rag-service', () => ({
  getAuthoritativeForSession: jest.fn()
}));

const { resolveInsuranceCodes } = require('../services/resolve-insurance-codes');

describe('collect_insurance HTTP spine integration', () => {
  const sessionId = 'http_spine_test_session';
  const origPost = KellyToolExecutor._post;

  beforeEach(() => {
    TriageRAGService.getAuthoritativeForSession.mockReturnValue({
      primary_icd10: 'K29.70',
      primary_cpt: '99213',
      rag_confidence: 0.85,
      target_specialty: 'Gastroenterology',
      urgency: 'routine',
      seeded_for_harness: 0
    });
    const db = require('../database');
    db.getTriageSession.mockReturnValue({
      session_id: sessionId,
      triage_complete: 1,
      opqrst_complete: 1,
      intake_complete_at: new Date().toISOString(),
      safety_level: 'green'
    });
    resolveInsuranceCodes.mockReturnValue({
      ok: true,
      primary_icd10: 'K29.70',
      primary_cpt: '99213',
      code_source: 'spine',
      rag_confidence: 0.85,
      code_pair_valid: true
    });
  });

  afterEach(() => {
    KellyToolExecutor._post = origPost;
    jest.clearAllMocks();
  });

  test('POST body omits service_code and succeeds without CLIENT_SERVICE_CODE_REJECTED', async () => {
    const posted = [];
    KellyToolExecutor._post = async (url, body) => {
      posted.push({ url, body });
      if (body.service_code) {
        return {
          success: false,
          error_code: 'CLIENT_SERVICE_CODE_REJECTED',
          message: 'Client-supplied service_code is not accepted.'
        };
      }
      return { success: true, patient_id: 'p_test' };
    };

    const result = await KellyToolExecutor._collectInsurance(
      { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', member_id: 'MBR1' },
      { sessionId, patientId: 'p_test', callerPhone: '+15555550123' }
    );

    expect(result.success).toBe(true);
    expect(result.error_code).not.toBe('CLIENT_SERVICE_CODE_REJECTED');
    expect(posted.length).toBe(1);
    expect(posted[0].url).toContain('/voice/insurance/collect');
    expect(posted[0].body.service_code).toBeUndefined();
    expect(posted[0].body.primary_cpt).toBe('99213');
    expect(posted[0].body.primary_icd10).toBe('K29.70');
    expect(resolveInsuranceCodes).toHaveBeenCalled();
  });
});
