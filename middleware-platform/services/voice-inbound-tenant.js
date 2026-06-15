'use strict';

/**
 * SaaS inbound voice tenant rules — avoid default Retell agent bleed for resolved tenants.
 */

function isSaasVoiceFailClosedEnabled() {
  const v = process.env.SAAS_VOICE_FAIL_CLOSED;
  if (v === '0' || v === 'false') return false;
  return true;
}

function isResolvedSaasTenant(customer) {
  if (!customer) return false;
  if (customer.customer_type === 'saas') return true;
  if (customer.trial_status === 'active') return true;
  return false;
}

/**
 * @param {object} params
 * @param {object|null} params.matchedCustomer
 * @param {string|null} params.customerId
 * @param {boolean} params.isSomoDemoDemo
 * @param {boolean} params.isOutboundSales
 * @param {string} params.currentRetellAgentId
 * @param {string} [params.defaultAgentId]
 * @returns {{ retellAgentId: string, failClosed: boolean, reason: string|null }}
 */
function resolveInboundRetellAgent({
  matchedCustomer,
  customerId,
  isSomoDemoDemo,
  isOutboundSales,
  callType,
  currentRetellAgentId,
  defaultAgentId
}) {
  const outboundType = String(callType || '').toLowerCase();
  const isOperatorOutbound = outboundType === 'operator_outbound' || outboundType === 'sales_outbound';

  if (isSomoDemoDemo || isOperatorOutbound) {
    return {
      retellAgentId: currentRetellAgentId,
      failClosed: false,
      reason: null
    };
  }

  // Tenant-initiated outbound misclassified as inbound should still fail-closed without agent
  if (isOutboundSales && !isOperatorOutbound && matchedCustomer && isResolvedSaasTenant(matchedCustomer)) {
    const tenantRetell = matchedCustomer?.retell_agent_id
      ? String(matchedCustomer.retell_agent_id).trim()
      : null;
    if (!tenantRetell && isSaasVoiceFailClosedEnabled()) {
      return {
        retellAgentId: currentRetellAgentId,
        failClosed: true,
        reason: 'missing_retell_agent_outbound'
      };
    }
  }

  const tenant = matchedCustomer || null;
  const tenantRetell = tenant?.retell_agent_id
    ? String(tenant.retell_agent_id).trim()
    : null;

  if (tenantRetell) {
    return { retellAgentId: tenantRetell, failClosed: false, reason: null };
  }

  if (tenant && isResolvedSaasTenant(tenant) && isSaasVoiceFailClosedEnabled()) {
    return {
      retellAgentId: currentRetellAgentId,
      failClosed: true,
      reason: 'missing_retell_agent'
    };
  }

  if (customerId && !tenant && isSaasVoiceFailClosedEnabled()) {
    return {
      retellAgentId: currentRetellAgentId,
      failClosed: false,
      reason: null
    };
  }

  const fallback =
    currentRetellAgentId ||
    defaultAgentId ||
    process.env.RETELL_AGENT_ID ||
    'agent_9151f738c705a56f4a0d8df63a';

  return { retellAgentId: fallback, failClosed: false, reason: null };
}

function buildMissingRetellTwiml(message) {
  const msg =
    message ||
    'Your clinic line is not fully configured yet. Please try again later or contact support.';
  const safe = String(msg).replace(/[<>&"']/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${safe}</Say>
  <Hangup/>
</Response>`;
}

module.exports = {
  isSaasVoiceFailClosedEnabled,
  isResolvedSaasTenant,
  resolveInboundRetellAgent,
  buildMissingRetellTwiml
};
