'use strict';

jest.mock('../services/kelly-conversation-graph', () => ({
  shouldUseKellyGraph: jest.fn(() => true),
  processTurn: jest.fn(async () => ({
    active_branch: 'clinical_intake',
    branch_step: 'start_intake'
  })),
  KELLY_BRANCH: { SKINCARE_EDUCATION: 'skincare_education', CLINICAL_INTAKE: 'clinical_intake' }
}));

jest.mock('../services/kelly-agent-service', () => ({
  processTurn: jest.fn(async (opts) => ({ reply: 'ok', toolsUsed: [], graphHost: opts.graphHost }))
}));

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { runKellyConversationTurn } = require('../services/kelly-conversation-bridge');

describe('kelly-conversation-bridge', () => {
  const sessionId = 'bridge-test-session';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets kelly_graph_branch and kelly_graph_step meta from graph route', async () => {
    const setSpy = jest.spyOn(KellyToolExecutor, '_setSessionMeta').mockImplementation(() => {});
    jest.spyOn(KellyToolExecutor, '_getSessionMeta').mockImplementation((sid, key) => {
      if (key === 'routine_intake_active') return '0';
      return null;
    });

    const out = await runKellyConversationTurn({
      sessionId,
      clinicId: 'clinic-default',
      message: 'I have a rash and need dermatology',
      channel: 'chat'
    });

    expect(out.reply).toBe('ok');
    expect(setSpy).toHaveBeenCalledWith(sessionId, 'kelly_graph_branch', 'clinical_intake');
    expect(setSpy).toHaveBeenCalledWith(sessionId, 'kelly_graph_step', 'start_intake');
    expect(setSpy).toHaveBeenCalledWith(sessionId, 'kelly_graph_active', '1');

    const KellyAgentService = require('../services/kelly-agent-service');
    expect(KellyAgentService.processTurn).toHaveBeenCalled();
    const callOpts = KellyAgentService.processTurn.mock.calls[0][0];
    expect(callOpts.graphHost).toBeDefined();
    expect(callOpts.graphHost.clinicalIntake).toBe(true);

    setSpy.mockRestore();
  });
});
