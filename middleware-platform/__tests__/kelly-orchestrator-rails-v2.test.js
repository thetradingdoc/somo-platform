'use strict';

describe('Kelly orchestrator vs rails v2', () => {
  const original = process.env.KELLY_RAILS_V2;

  afterEach(() => {
    if (original === undefined) delete process.env.KELLY_RAILS_V2;
    else process.env.KELLY_RAILS_V2 = original;
    jest.resetModules();
  });

  test('orchestratorEnabled is false when KELLY_RAILS_V2=1', () => {
    process.env.KELLY_RAILS_V2 = '1';
    process.env.KELLY_RAILS_ROLLOUT_PCT = '1';
    const KellyOrchestratorPhase = require('../services/kelly-orchestrator-phase');
    expect(KellyOrchestratorPhase.orchestratorEnabled()).toBe(false);
  });

  test('orchestratorEnabled respects KELLY_ORCHESTRATOR_PHASE=0 when rails off', () => {
    delete process.env.KELLY_RAILS_V2;
    process.env.KELLY_ORCHESTRATOR_PHASE = '0';
    const KellyOrchestratorPhase = require('../services/kelly-orchestrator-phase');
    expect(KellyOrchestratorPhase.orchestratorEnabled()).toBe(false);
  });
});
