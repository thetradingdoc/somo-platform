'use strict';

const { routeOrchestratorLane, KELLY_LANE, normalizeState } = require('../services/kelly-rails/state-schema');
const { getAllowedToolNames } = require('../services/kelly-rails/tool-allowlists');
const {
  isHybridGraphAllowed,
  isLegacyProcessTurnAllowed,
  isProductionKellyEnforced
} = require('../services/kelly-rails/runtime-guard');

describe('kelly-rails architecture — runtime guard', () => {
  const savedProfile = process.env.KELLY_RUNTIME_PROFILE;
  const savedHybrid = process.env.KELLY_ALLOW_HYBRID_GRAPH;
  const savedLegacy = process.env.KELLY_ALLOW_LEGACY_PROCESS_TURN;

  afterEach(() => {
    if (savedProfile === undefined) delete process.env.KELLY_RUNTIME_PROFILE;
    else process.env.KELLY_RUNTIME_PROFILE = savedProfile;
    if (savedHybrid === undefined) delete process.env.KELLY_ALLOW_HYBRID_GRAPH;
    else process.env.KELLY_ALLOW_HYBRID_GRAPH = savedHybrid;
    if (savedLegacy === undefined) delete process.env.KELLY_ALLOW_LEGACY_PROCESS_TURN;
    else process.env.KELLY_ALLOW_LEGACY_PROCESS_TURN = savedLegacy;
  });

  test('blocks hybrid and legacy in production profile', () => {
    process.env.KELLY_RUNTIME_PROFILE = 'production';
    process.env.KELLY_ALLOW_HYBRID_GRAPH = '1';
    process.env.KELLY_ALLOW_LEGACY_PROCESS_TURN = '1';
    expect(isProductionKellyEnforced()).toBe(true);
    expect(isHybridGraphAllowed()).toBe(false);
    expect(isLegacyProcessTurnAllowed()).toBe(false);
  });
});

describe('kelly-rails architecture — records lane', () => {
  test('routes records signals to records lane with FHIR read tools only', () => {
    const state = normalizeState({
      session_id: 'sess-rec',
      last_user_message: 'what did my doctor say on my last visit'
    });
    const route = routeOrchestratorLane(state);
    expect(route.lane).toBe(KELLY_LANE.RECORDS);
    const allowed = getAllowedToolNames('records', 'records_qa');
    expect(allowed).toContain('query_patient_records');
    expect(allowed).not.toContain('schedule_appointment');
    expect(allowed).not.toContain('request_patient_payment');
  });
});

describe('kelly-rails architecture — healthcare education', () => {
  test('strips skincare routine tools when routine_intake_active=0', () => {
    const allowed = getAllowedToolNames('education', 'education', { routine_intake_active: false });
    expect(allowed).not.toContain('evaluate_skincare_routine');
    expect(allowed).toContain('run_derm_patient_qa');
  });

  test('non-routine education utterance routes to clinical or support, not education lane', () => {
    const state = normalizeState({
      session_id: 'sess-ed',
      flags: { routine_intake_active: false },
      last_user_message: 'what moisturizer should I use for dry skin'
    });
    const route = routeOrchestratorLane(state);
    expect(route.lane).not.toBe(KELLY_LANE.EDUCATION);
  });
});
