'use strict';

/** Modes enabled for staged production rollout while CONVERSATION_MODE_ROUTING=shadow. */
const STAGED_ENFORCE_MODE_DEFAULTS = Object.freeze({
  operator_outbound: true,
  outbound_sales: true,
  demo_qual: false,
  tenant_inbound_admin: false,
  tenant_inbound_clinical: false,
  tenant_billing: false,
  tenant_records: true,
  emergency_safety: false
});

function isConversationModeRoutingEnforced() {
  return process.env.CONVERSATION_MODE_ROUTING === 'enforce';
}

function isConversationModeRoutingShadow() {
  const v = process.env.CONVERSATION_MODE_ROUTING;
  return !v || v === 'shadow';
}

function isPerModeEnforceFlag(mode) {
  const key = `CONVERSATION_MODE_ENFORCE_${String(mode || '').toUpperCase().replace(/-/g, '_')}`;
  const raw = process.env[key];
  return raw === '1' || raw === 'true';
}

function shouldEnforceMode(mode) {
  if (isConversationModeRoutingEnforced()) return true;
  return isPerModeEnforceFlag(mode);
}

function getStagedEnforceSnapshot() {
  return {
    routing: process.env.CONVERSATION_MODE_ROUTING || 'shadow',
    global_enforce: isConversationModeRoutingEnforced(),
    per_mode: Object.fromEntries(
      Object.keys(STAGED_ENFORCE_MODE_DEFAULTS).map((m) => [m, shouldEnforceMode(m)])
    )
  };
}

module.exports = {
  STAGED_ENFORCE_MODE_DEFAULTS,
  isConversationModeRoutingEnforced,
  isConversationModeRoutingShadow,
  isPerModeEnforceFlag,
  shouldEnforceMode,
  getStagedEnforceSnapshot
};
