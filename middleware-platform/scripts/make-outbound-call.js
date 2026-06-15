#!/usr/bin/env node

/**
 * Make an outbound call via Twilio (operator account).
 * Usage: node scripts/make-outbound-call.js <phone_number>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const twilio = require('twilio');
const { resolveTelephonyWebhookBase } = require('../utils/telephony-webhook-base');
const { getOperatorCustomerId } = require('../services/voice-account-resolution');

const phoneNumber = process.argv[2];

if (!phoneNumber) {
  console.error('❌ Error: Phone number required');
  console.log('Usage: node scripts/make-outbound-call.js <phone_number>');
  process.exit(1);
}

function formatPhoneNumber(num) {
  let cleaned = String(num).replace(/\D/g, '');
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  if (String(num).startsWith('+')) return String(num);
  return `+${cleaned}`;
}

async function makeCall() {
  try {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const agentId = process.env.RETELL_AGENT_ID || process.env.RETELL_SALES_AGENT_ID;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    const toNumber = formatPhoneNumber(phoneNumber);
    const operatorCustomerId = getOperatorCustomerId();

    if (!agentId) throw new Error('RETELL_AGENT_ID or RETELL_SALES_AGENT_ID not configured');
    if (!fromNumber) throw new Error('TWILIO_PHONE_NUMBER not configured');
    if (!operatorCustomerId) {
      throw new Error('CALLSOMO_OPERATOR_CUSTOMER_ID or CALLSOMO_VOICE_CUSTOMER_ID not configured');
    }

    const apiBase = await resolveTelephonyWebhookBase();

    console.log('📞 Making operator outbound call...');
    console.log(`   From: ${fromNumber}`);
    console.log(`   To: ${toNumber}`);
    console.log(`   Agent: ${agentId}`);
    console.log(`   Operator customer: ${operatorCustomerId}`);
    console.log(`   Webhook base: ${apiBase}`);
    console.log('');

    const webhookUrl = new URL(`${apiBase}/voice/incoming`);
    webhookUrl.searchParams.set('call_type', 'operator_outbound');
    webhookUrl.searchParams.set('agent_id', agentId);
    webhookUrl.searchParams.set('customer_id', operatorCustomerId);
    webhookUrl.searchParams.set('test_mode', 'manual_script');

    const twilioCall = await twilioClient.calls.create({
      from: fromNumber,
      to: toNumber,
      url: webhookUrl.toString(),
      statusCallback: `${apiBase}/voice/status-callback`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
    });

    console.log('✅ Call initiated successfully!');
    console.log(`   Call SID: ${twilioCall.sid}`);
    console.log(`   Status: ${twilioCall.status || 'queued'}`);
    console.log(`   Provider: twilio_direct`);
  } catch (error) {
    console.error('❌ Failed to make call:', error.message);
    process.exit(1);
  }
}

makeCall();
