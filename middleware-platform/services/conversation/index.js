'use strict';

const { resolveConversationMode } = require('./conversation-mode-resolver');
const { evaluateTurn, applyPivotToSession } = require('./pivot-engine');
const { loadTenantPolicyFromProfile } = require('./tenant-policy');
const { resolveDispositionFromState } = require('./disposition-taxonomy');
const { dispatchConversationTurn } = require('./conversation-dispatcher');
const { isToolAllowedForMode, logModeViolation } = require('./mode-tool-firewall');
const {
  ConversationMode,
  Subrail,
  BillingStep,
  UserIntent,
  normalizeCallType,
  normalizeDirection
} = require('./conversation-mode-types');
const { PivotEvent } = require('./pivot-events');
const { OpqrstExitState } = require('./opqrst-exit-states');
const { Disposition } = require('./disposition-taxonomy');
const { ACCEPTANCE_SCENARIOS, getScenario } = require('./acceptance-matrix');
const {
  isConversationModeRoutingEnforced,
  isConversationModeRoutingShadow,
  shouldEnforceMode,
  getStagedEnforceSnapshot,
  STAGED_ENFORCE_MODE_DEFAULTS
} = require('./config');

module.exports = {
  resolveConversationMode,
  evaluateTurn,
  applyPivotToSession,
  loadTenantPolicyFromProfile,
  resolveDispositionFromState,
  dispatchConversationTurn,
  isToolAllowedForMode,
  logModeViolation,
  ConversationMode,
  Subrail,
  BillingStep,
  UserIntent,
  PivotEvent,
  OpqrstExitState,
  Disposition,
  ACCEPTANCE_SCENARIOS,
  getScenario,
  normalizeCallType,
  normalizeDirection,
  isConversationModeRoutingEnforced,
  isConversationModeRoutingShadow,
  shouldEnforceMode,
  getStagedEnforceSnapshot,
  STAGED_ENFORCE_MODE_DEFAULTS
};
