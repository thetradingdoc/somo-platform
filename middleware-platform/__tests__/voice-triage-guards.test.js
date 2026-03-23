/**
 * impl-14: resolveVoiceSessionIdForGuard priority
 * impl-10: TRIAGE_NOT_STARTED when id present but no triage row
 */
const mockGetTriageSession = jest.fn();
const mockIncrementOps = jest.fn();

jest.mock('../database', () => ({
  getTriageSession: (...a) => mockGetTriageSession(...a),
  incrementOpsCounter: (...a) => mockIncrementOps(...a)
}));

jest.mock('../services/kelly-tool-executor', () => ({
  _confidenceFromTriageRow: () => 0.9
}));

jest.mock('../services/triage-rag-service', () => ({
  getLatestForSession: () => ({ rag_confidence: 0.9 })
}));

const {
  resolveVoiceSessionIdForGuard,
  enforceVoiceTriageGuardrailsForSession
} = require('../services/voice-triage-guards');

describe('resolveVoiceSessionIdForGuard (impl-14)', () => {
  it('prefers top-level session_id over call_id when both differ', () => {
    const sid = resolveVoiceSessionIdForGuard(
      { session_id: 'sess-a', call_id: 'call-b' },
      { body: {} }
    );
    expect(sid).toBe('sess-a');
  });

  it('uses metadata.session_id when session_id absent', () => {
    const sid = resolveVoiceSessionIdForGuard(
      { metadata: { session_id: 'meta-s' }, call_id: 'call-b' },
      { body: {} }
    );
    expect(sid).toBe('meta-s');
  });

  it('falls back to call_id', () => {
    const sid = resolveVoiceSessionIdForGuard({ call_id: 'only-call' }, { body: {} });
    expect(sid).toBe('only-call');
  });
});

describe('enforceVoiceTriageGuardrailsForSession (impl-10)', () => {
  const res = () => {
    const r = { statusCode: 200, body: null };
    r.status = (c) => {
      r.statusCode = c;
      return r;
    };
    r.json = (b) => {
      r.body = b;
      return r;
    };
    return r;
  };

  beforeEach(() => {
    mockGetTriageSession.mockReset();
    mockIncrementOps.mockReset();
  });

  it('returns 403 TRIAGE_NOT_STARTED when session id present but no triage row', () => {
    mockGetTriageSession.mockReturnValue(null);
    const r = res();
    const ok = enforceVoiceTriageGuardrailsForSession('call-123', {}, r, 'schedule');
    expect(ok).toBe(false);
    expect(r.statusCode).toBe(403);
    expect(r.body.error_code).toBe('TRIAGE_NOT_STARTED');
  });

  it('proceeds when triage row complete (minimal)', () => {
    mockGetTriageSession.mockReturnValue({
      safety_level: 'green',
      referred_to_911: 0,
      triage_complete: 1,
      opqrst_complete: 1,
      intake_complete_at: '2026-01-01',
      rag_result_id: 'x'
    });
    const r = res();
    const ok = enforceVoiceTriageGuardrailsForSession('s1', {}, r, 'schedule');
    expect(ok).toBe(true);
  });
});
