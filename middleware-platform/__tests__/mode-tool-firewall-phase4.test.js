'use strict';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const RetellWebSocketHandler = require('../webhooks/retell-websocket');
const {
  isToolAllowedForMode,
  isRegisteredToolName
} = require('../services/conversation-mode/mode-tool-firewall');

jest.mock('../database', () => ({
  insertKellyCallEvent: jest.fn(),
  incrementOpsCounter: jest.fn(),
  getTriageSession: jest.fn(),
  getOrchestrateSessionBySessionId: jest.fn()
}));

describe('Phase 4 tool-execution firewall', () => {
  let executeCoreSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    executeCoreSpy = jest
      .spyOn(KellyToolExecutor, '_executeToolCore')
      .mockResolvedValue({ success: true });
  });

  afterEach(() => {
    executeCoreSpy.mockRestore();
  });

  test('4.1 KellyToolExecutor.execute blocks disallowed tools directly', async () => {
    const out = await KellyToolExecutor.execute(
      'check_plan_benefits',
      {},
      {
        sessionId: 'sess-1',
        clinicId: 'clinic-1',
        conversation_mode: 'tenant_inbound_admin',
        active_subrail: 'booking',
        triage_policy: 'disabled',
        use_case: 'dental'
      }
    );
    expect(out.success).toBe(false);
    expect(out.error_code).toBe('MODE_FIREWALL_BLOCKED');
    expect(executeCoreSpy).not.toHaveBeenCalled();
  });

  test('4.4 unknown tool names default-deny', () => {
    expect(isRegisteredToolName('totally_unregistered_tool_xyz')).toBe(false);
    expect(
      isToolAllowedForMode('totally_unregistered_tool_xyz', {
        conversation_mode: 'tenant_inbound_admin',
        active_subrail: 'booking',
        triage_policy: 'disabled',
        site_context_status: 'verified'
      })
    ).toBe(false);
  });

  test('4.3 dental Retell modeCtx blocks check_plan_benefits like node-runner', () => {
    const ctx = {
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'booking',
      triage_policy: 'disabled',
      use_case: 'dental',
      site_context_status: 'verified',
      routing_world: 'tenant'
    };
    expect(isToolAllowedForMode('check_plan_benefits', ctx)).toBe(false);
    expect(isToolAllowedForMode('collect_insurance', ctx)).toBe(true);
  });
});

describe('Phase 4 replayFunctionCall firewall', () => {
  test('4.2 blocks disallowed replay tools', async () => {
    const db = { insertKellyCallEvent: jest.fn() };
    const handler = new RetellWebSocketHandler(db, { apiBaseUrl: 'http://localhost:4000' });
    const callId = 'replay-fw-1';
    handler.activeConnections.set(callId, {
      clinic_id: 'clinic-1',
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'booking',
      triage_policy: 'disabled',
      use_case: 'dental'
    });

    const out = await handler.replayFunctionCall(callId, 'check_plan_benefits', {});
    expect(out.success).toBe(false);
    expect(out.error_code).toBe('MODE_FIREWALL_BLOCKED');
  });

  test('4.2 replay routes run_triage_rag through KellyToolExecutor', async () => {
    const executeSpy = jest
      .spyOn(KellyToolExecutor, 'execute')
      .mockResolvedValue({ success: true, triage_complete: true });

    const db = { insertKellyCallEvent: jest.fn() };
    const handler = new RetellWebSocketHandler(db, { apiBaseUrl: 'http://localhost:4000' });
    const callId = 'replay-rag-1';
    handler.activeConnections.set(callId, {
      clinic_id: 'clinic-1',
      conversation_mode: 'tenant_inbound_clinical',
      active_subrail: 'opqrst',
      triage_policy: 'required',
      use_case: 'dermatology'
    });

    const out = await handler.replayFunctionCall(callId, 'run_triage_rag', { symptoms: 'rash' });
    expect(out.success).toBe(true);
    expect(executeSpy).toHaveBeenCalledWith(
      'run_triage_rag',
      expect.any(Object),
      expect.objectContaining({ sessionId: callId, triage_policy: 'required' })
    );

    executeSpy.mockRestore();
  });
});

describe('Phase 4 gate-bypass telemetry', () => {
  test('4.7 _logGateBypass increments ops counter', () => {
    const db = require('../database');
    KellyToolExecutor._logGateBypass('sess-bypass', 'front_desk_slots_bypass', { test: 1 });
    expect(db.incrementOpsCounter).toHaveBeenCalledWith('gate_bypass_front_desk_slots_bypass');
    expect(db.insertKellyCallEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'gate_bypass', session_id: 'sess-bypass' })
    );
  });
});
