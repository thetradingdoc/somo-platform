'use strict';

/**
 * Account Resolution Contract — every voice call must resolve customer_id before register-phone-call.
 */

const OUTBOUND_CALL_TYPES = new Set([
  'sales_outbound',
  'operator_outbound',
  'rcm_follow_up',
  'outbound'
]);

function getOperatorCustomerId() {
  return (
    process.env.CALLSOMO_OPERATOR_CUSTOMER_ID ||
    process.env.CALLSOMO_VOICE_CUSTOMER_ID ||
    null
  );
}

function isOutboundCallType(callType) {
  return OUTBOUND_CALL_TYPES.has(String(callType || '').toLowerCase());
}

function isOutboundRequest(req, isSomoDemoDemo) {
  if (isSomoDemoDemo) return false;
  const callType = req.query.call_type ? String(req.query.call_type) : null;
  return (
    isOutboundCallType(callType) ||
    !!req.query.lead_id ||
    String(req.body?.Direction || req.body?.direction || '').toLowerCase() === 'outbound-api'
  );
}

function normalizeCallType(req, { isOutbound, isSomoDemoDemo, leadId }) {
  if (isSomoDemoDemo) return 'somo_demo';
  const explicit = req.query.call_type ? String(req.query.call_type) : null;
  if (explicit) return explicit;
  if (leadId) return 'sales_outbound';
  if (isOutbound) return 'operator_outbound';
  return 'inbound_tenant';
}

/**
 * Inbound navigation customer bound to To DID (overrides Twilio URL customer_id).
 */
function resolveNavigationInboundByDid(db, normalizedToNumber) {
  if (!normalizedToNumber) return null;
  try {
    const { isNavigationEnabled } = require('./navigation/navigation-config');
    if (!isNavigationEnabled()) return null;
  } catch (_) {
    return null;
  }
  const row = db.getCustomerByTwilioNumber(normalizedToNumber);
  return isNavigationCustomer(row) ? row : null;
}

/**
 * Resolve customer_id and matched customer for a voice webhook.
 */
function resolveVoiceAccount(db, req, opts) {
  const { normalizedToNumber, isSomoDemoDemo, isOutbound, leadId } = opts;
  let customerId = req.query.customer_id ? String(req.query.customer_id).trim() : null;
  let matchedCustomer = null;
  let clinicId = req.query.clinic_id ? String(req.query.clinic_id).trim() : null;

  if (!isOutbound && !isSomoDemoDemo) {
    const navCustomer = resolveNavigationInboundByDid(db, normalizedToNumber);
    if (navCustomer) {
      customerId = navCustomer.id;
      matchedCustomer = navCustomer;
      console.log(`✅ Navigation inbound via DID: ${customerId}`);
      return {
        customerId,
        matchedCustomer,
        clinicId,
        agentIdFromRequest: req.query.agent_id || req.headers?.['x-retell-agent-id']
      };
    }
  }

  if (customerId) {
    matchedCustomer = db.getCustomer(customerId);
    if (!matchedCustomer) {
      console.warn(`⚠️  customer_id query param not found: ${customerId}`);
      customerId = null;
    }
  }

  if (!customerId && isOutbound) {
    const operatorId = getOperatorCustomerId();
    if (operatorId) {
      matchedCustomer = db.getCustomer(operatorId);
      if (matchedCustomer) {
        customerId = operatorId;
        console.log(`✅ Operator outbound: customer_id=${customerId}`);
      }
    }
  }

  if (!customerId && !isOutbound && !isSomoDemoDemo) {
    const customerByNumber = db.getCustomerByTwilioNumber(normalizedToNumber);
    if (customerByNumber) {
      matchedCustomer = customerByNumber;
      customerId = customerByNumber.id;
      console.log(`✅ Matched customer via Twilio number: ${customerId}`);
    } else {
      const clinicPhone = db.getClinicPhoneNumber(normalizedToNumber);
      if (clinicPhone?.clinic_id) {
        clinicId = clinicId || clinicPhone.clinic_id;
        const mapped = db.getCustomerIdForClinic?.(clinicPhone.clinic_id);
        if (mapped && db.getCustomer(mapped)) {
          customerId = mapped;
          matchedCustomer = db.getCustomer(mapped);
        }
      }
    }
  }

  const agentIdFromRequest = req.query.agent_id || req.headers?.['x-retell-agent-id'];
  if (!customerId && agentIdFromRequest) {
    const customer = db.db
      .prepare('SELECT * FROM customers WHERE retell_agent_id = ?')
      .get(agentIdFromRequest);
    if (customer) {
      matchedCustomer = customer;
      customerId = customer.id;
      console.log(`✅ Found customer by agent_id: ${customerId}`);
    }
  }

  if (!matchedCustomer && customerId) {
    matchedCustomer = db.getCustomer(customerId);
  }

  return { customerId, matchedCustomer, clinicId, agentIdFromRequest };
}

/**
 * Resolve Retell agent for outbound — honors req.query.agent_id.
 */
function resolveOutboundRetellAgent(req, matchedCustomer, defaultAgentId) {
  const fromQuery = req.query.agent_id ? String(req.query.agent_id).trim() : null;
  if (fromQuery) return fromQuery;
  if (matchedCustomer?.retell_agent_id) return matchedCustomer.retell_agent_id;
  return (
    process.env.RETELL_SALES_AGENT_ID ||
    process.env.RETELL_AGENT_ID ||
    defaultAgentId ||
    'agent_9151f738c705a56f4a0d8df63a'
  );
}

/**
 * Resolve merchant_id without akin-dunbar / first-merchant fallbacks.
 */
function resolveMerchantForVoice(db, {
  customerId,
  matchedCustomer,
  merchantIdFromQuery,
  retellAgentId,
  clinicId
}) {
  let merchantId = merchantIdFromQuery ? String(merchantIdFromQuery).trim() : null;
  let reason = merchantId ? 'query_param' : 'none';

  if (!merchantId && matchedCustomer?.merchant_id) {
    merchantId = matchedCustomer.merchant_id;
    reason = 'customer_record';
  }
  if (!merchantId && customerId) {
    const customer = matchedCustomer || db.getCustomer(customerId);
    if (customer?.merchant_id) {
      merchantId = customer.merchant_id;
      reason = 'customer_lookup';
    } else if (customer?.id) {
      merchantId = db.customerVoiceSettingsMerchantKey(customer.id);
      if (merchantId) reason = 'customer_voice_settings_key';
    }
  }
  if (!merchantId && clinicId) {
    const clinic = db.getClinicById?.(clinicId);
    if (clinic?.merchant_id) {
      merchantId = clinic.merchant_id;
      reason = 'clinic_record';
    }
  }
  if (!merchantId && retellAgentId) {
    try {
      const merchantByAgent = db.db
        .prepare('SELECT id FROM merchants WHERE retell_agent_id = ? LIMIT 1')
        .get(retellAgentId);
      if (merchantByAgent?.id) {
        merchantId = merchantByAgent.id;
        reason = 'merchant_retell_agent_id';
      }
    } catch (_) { /* column may not exist */ }

    if (!merchantId) {
      const customerByAgent = db.db
        .prepare('SELECT * FROM customers WHERE retell_agent_id = ?')
        .get(retellAgentId);
      if (customerByAgent?.merchant_id) {
        merchantId = customerByAgent.merchant_id;
        reason = 'customer_retell_agent_id';
      }
    }
    if (!merchantId) {
      const clinicWithAgent = db.db
        .prepare('SELECT merchant_id FROM clinics WHERE retell_agent_id = ? AND merchant_id IS NOT NULL LIMIT 1')
        .get(retellAgentId);
      if (clinicWithAgent?.merchant_id) {
        merchantId = clinicWithAgent.merchant_id;
        reason = 'clinic_retell_agent_id';
      }
    }
  }

  return { merchantId: merchantId || null, reason };
}

function resolveCustomerIdForBilling(db, connection) {
  const direct = connection?.customer_id ? String(connection.customer_id).trim() : null;
  if (direct && db.getCustomer(direct)) return direct;

  const metaCid =
    connection?.callMetadata?.metadata?.customer_id ||
    connection?.callMetadata?.dynamic_variables?.customer_id ||
    null;
  if (metaCid && db.getCustomer(String(metaCid))) return String(metaCid);

  const clinicId = connection?.clinic_id;
  if (clinicId && typeof db.getCustomerIdForClinic === 'function') {
    const mapped = db.getCustomerIdForClinic(clinicId);
    if (mapped && db.getCustomer(mapped)) return mapped;
  }

  const operatorId = getOperatorCustomerId();
  if (
    operatorId &&
    (connection?.callMetadata?.metadata?.call_type === 'sales_outbound' ||
      connection?.callMetadata?.metadata?.call_type === 'operator_outbound')
  ) {
    if (db.getCustomer(operatorId)) return operatorId;
  }

  return null;
}

function buildAccountResolutionFailureTwiml(message) {
  const safe = String(
    message || 'We are unable to connect your call right now. Please try again later.'
  ).replace(/[<>&"']/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${safe}</Say>
  <Hangup/>
</Response>`;
}

function isNavigationCustomer(customer) {
  return String(customer?.customer_type || '').toLowerCase() === 'navigation';
}

/** Demo calls may proceed without a resolved tenant customer_id. */
function requiresCustomerId(isSomoDemoDemo) {
  return !isSomoDemoDemo;
}

module.exports = {
  getOperatorCustomerId,
  isOutboundCallType,
  isOutboundRequest,
  normalizeCallType,
  resolveVoiceAccount,
  resolveOutboundRetellAgent,
  resolveMerchantForVoice,
  resolveCustomerIdForBilling,
  buildAccountResolutionFailureTwiml,
  requiresCustomerId,
  isNavigationCustomer,
  resolveNavigationInboundByDid,
  resolveVoiceMerchantId: (db, customer) => {
    if (!customer) return null;
    if (customer.merchant_id) return customer.merchant_id;
    return db.customerVoiceSettingsMerchantKey(customer.id);
  }
};
