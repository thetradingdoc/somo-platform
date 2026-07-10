'use strict';

const { runAllGates } = require('./helpers/portal-e2e-gates.cjs');
const { parseEnv, log } = require('./helpers/portal-e2e-config.cjs');
const { assertModeAllowed, resetState } = require('./helpers/portal-e2e-create-state.cjs');

module.exports = async function globalSetup() {
  const config = parseEnv();
  log(`globalSetup env=${config.pwEnv} mode=${config.pwMode} tier=${config.pwTier} runner=${config.runner}`);

  if (config.forceRollback) {
    log('globalSetup: PW_FORCE_ROLLBACK=1 — resetting create state');
    resetState('force_rollback');
  }

  const modeCheck = assertModeAllowed(config.pwMode, { forceRollback: config.forceRollback });
  if (!modeCheck.ok) {
    throw new Error(modeCheck.error);
  }

  const gates = await runAllGates(config);
  if (!gates.ok && config.isProd) {
    throw new Error('Production pre-flight gates failed — aborting portal E2E');
  }

  process.env.PORTAL_E2E_GATES_OK = gates.ok ? '1' : '0';
  log(`globalSetup complete gates=${gates.ok ? 'pass' : 'fail'}`);
};
