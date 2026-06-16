'use strict';

const db = require('../database');
const twilio = require('twilio');
const { resolveTemplate } = require('./somo-demo-template-registry');
const { resolveTelephonyWebhookBase } = require('../utils/telephony-webhook-base');

/**
 * Initiate outbound call via Twilio (same path as routes/outbound-call.js).
 */
async function initiateOutboundCall({ phone_number, merchantId, customer_id, call_type = 'rcm_follow_up', clinic_id }) {
  if (!phone_number) throw new Error('Phone number is required');
  const phoneRegex = /^\+?[\d\s\-()]{10,}$/;
  if (!phoneRegex.test(phone_number)) throw new Error('Invalid phone number format');
  if (!merchantId) throw new Error('Merchant context is required');

  const merchant = db.getMerchant(merchantId);
  if (!merchant) throw new Error('Merchant not found');

  let retellAgentId = null;
  if (customer_id) {
    const _customer = db.getCustomer(customer_id);
    retellAgentId = _customer?.retell_agent_id || null;
  }
  if (!retellAgentId) {
    const clinic = db.getClinicBySlug(merchant.subdomain || '');
    retellAgentId = clinic?.retell_agent_id || null;
  }
  retellAgentId = retellAgentId || process.env.RETELL_AGENT_ID;
  if (!retellAgentId) throw new Error('Voice agent not configured');

  let fromNumber = null;
  if (customer_id) {
    const _customer = db.getCustomer(customer_id);
    fromNumber = _customer?.twilio_phone_number || null;
  }
  fromNumber =
    fromNumber ||
    process.env.CALLSOMO_OPERATOR_TWILIO_NUMBER ||
    process.env.TWILIO_PHONE_NUMBER;
  if (!fromNumber) throw new Error('No outbound phone number configured');

  const apiBase = await resolveTelephonyWebhookBase();

  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const webhookUrl = new URL(`${apiBase}/voice/incoming`);
  webhookUrl.searchParams.set('call_type', call_type || 'operator_outbound');
  webhookUrl.searchParams.set('agent_id', retellAgentId);
  webhookUrl.searchParams.set('direction', 'outbound');
  if (merchantId) webhookUrl.searchParams.set('merchant_id', String(merchantId));
  if (customer_id) webhookUrl.searchParams.set('customer_id', String(customer_id));
  if (clinic_id) webhookUrl.searchParams.set('clinic_id', String(clinic_id));

  const twilioCall = await twilioClient.calls.create({
    from: fromNumber,
    to: phone_number,
    url: webhookUrl.toString(),
    statusCallback: `${apiBase}/voice/status-callback`,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  });

  return {
    success: true,
    call_id: twilioCall.sid,
    provider: 'twilio_direct',
    phone_number,
  };
}

/**
 * Public Somo demo landing demo — no merchant context.
 */
async function initiateSomoDemoDemoCall({
  phone_number,
  demo_request_id,
  use_case,
  prospect_name,
  template: templateIn
}) {
  if (!phone_number) throw new Error('Phone number is required');

  const template = templateIn || resolveTemplate({ use_case: use_case || 'receptionist' });
  const retellAgentId = template.agentId;
  const fromNumber = template.fromNumber;

  const apiBase = await resolveTelephonyWebhookBase();

  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const webhookUrl = new URL(`${apiBase}/voice/incoming`);
  webhookUrl.searchParams.set('call_type', 'somo_demo');
  webhookUrl.searchParams.set('agent_id', retellAgentId);
  if (demo_request_id) webhookUrl.searchParams.set('demo_request_id', String(demo_request_id));
  if (use_case) webhookUrl.searchParams.set('use_case', String(use_case));
  if (prospect_name) webhookUrl.searchParams.set('prospect_name', encodeURIComponent(String(prospect_name)));

  const statusCallback = `${apiBase}/voice/status-callback`;
  const amdCallback = `${apiBase}/voice/somo-demo-amd-callback`;

  const twilioCall = await twilioClient.calls.create({
    from: fromNumber,
    to: phone_number,
    url: webhookUrl.toString(),
    statusCallback,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'busy', 'no-answer', 'failed', 'canceled'],
    machineDetection: 'Enable',
    asyncAmd: true,
    asyncAmdStatusCallback: amdCallback,
    asyncAmdStatusCallbackMethod: 'POST'
  });

  return {
    success: true,
    call_id: twilioCall.sid,
    provider: 'twilio_direct',
    phone_number,
    template_id: template.template_id
  };
}

module.exports = { initiateOutboundCall, initiateSomoDemoDemoCall, resolveTemplate };
