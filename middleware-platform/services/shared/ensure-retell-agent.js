'use strict';

const RetellService = require('../voice/retell-service');

/**
 * Ensure a SaaS customer has a Retell agent (lazy create on settings/prompt save).
 * @param {object} db - database module
 * @param {string} customerId
 * @param {{ retellService?: object }} [options]
 * @returns {Promise<{ agentId: string|null, created: boolean, error: string|null }>}
 */
async function ensureCustomerRetellAgent(db, customerId, options = {}) {
  const customer = db.getCustomer(customerId);
  if (!customer) {
    return { agentId: null, created: false, error: 'Customer not found' };
  }

  if (customer.retell_agent_id) {
    return { agentId: customer.retell_agent_id, created: false, error: null };
  }

  const retellService = options.retellService || new RetellService();
  try {
    const agentResult = await retellService.createAgent({
      name: customer.company_name || customer.name,
      phone_number: customer.phone_number || customer.twilio_phone_number || null
    });

    if (agentResult.success && agentResult.agent_id) {
      db.updateCustomerRetellAgent(customerId, agentResult.agent_id, 'active');

      const merchantId = customer.merchant_id || null;
      if (typeof db.upsertVoiceAgentSettings === 'function') {
        let existing = null;
        if (typeof db.getVoiceAgentSettingsForProvider === 'function') {
          existing = db.getVoiceAgentSettingsForProvider({ merchantId, customerId });
        }
        db.upsertVoiceAgentSettings(
          merchantId,
          {
            retell_agent_id: agentResult.agent_id,
            enabled: existing?.enabled !== 0 && existing?.enabled !== false,
            greeting: existing?.greeting ?? null,
            after_hours_message: existing?.after_hours_message ?? null,
            business_hours: existing?.business_hours ?? null
          },
          customerId
        );
      }

      return { agentId: agentResult.agent_id, created: true, error: null };
    }

    const err = agentResult.error || 'Retell agent creation failed';
    console.warn(`[ensureRetellAgent] customer ${customerId}: ${err}`);
    return { agentId: null, created: false, error: err };
  } catch (e) {
    console.warn(`[ensureRetellAgent] customer ${customerId}:`, e.message);
    return { agentId: null, created: false, error: e.message };
  }
}

module.exports = { ensureCustomerRetellAgent };
