'use strict';

const {
  ConversationMode,
  Subrail
} = require('../services/conversation-mode/conversation-mode-types');

describe('store_triage_opqrst site gate (SITE-22)', () => {
  let KellyToolExecutor;
  let upsertSpy;
  let getSpy;

  beforeEach(() => {
    jest.resetModules();
    KellyToolExecutor = require('../services/kelly-tool-executor');
    const db = require('../database');
    upsertSpy = jest.spyOn(db, 'upsertTriageSession').mockReturnValue('triage-1');
    getSpy = jest.spyOn(db, 'getTriageSession').mockReturnValue({});
    if (typeof db.getKellySessionLanguage === 'function') {
      jest.spyOn(db, 'getKellySessionLanguage').mockReturnValue(null);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const clinicalOpqrstCtx = {
    conversation_mode: ConversationMode.TENANT_INBOUND_CLINICAL,
    active_subrail: Subrail.OPQRST,
    channel: 'voice'
  };

  test('blocks when site_context_status is missing', async () => {
    const out = await KellyToolExecutor.execute(
      'store_triage_opqrst',
      { onset: 'today', quality: 'sharp pain' },
      {
        ...clinicalOpqrstCtx,
        sessionId: 'sess-1',
        clinicId: 'clinic-1',
        site_context_status: 'missing'
      }
    );
    expect(out.success).toBe(false);
    // Mode firewall blocks site-sensitive tools before executor site gate.
    expect(['MODE_FIREWALL_BLOCKED', 'site_context_unverified']).toContain(out.error);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  test('allows when site_context_status is verified', async () => {
    const out = await KellyToolExecutor.execute(
      'store_triage_opqrst',
      { onset: 'today', quality: 'sharp pain', severity: 5, timing: 'constant' },
      {
        ...clinicalOpqrstCtx,
        sessionId: 'sess-2',
        clinicId: 'clinic-1',
        site_context_status: 'verified'
      }
    );
    expect(out.success).not.toBe(false);
    expect(getSpy).toHaveBeenCalled();
  });
});
