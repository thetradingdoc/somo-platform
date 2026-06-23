#!/usr/bin/env node

/**
 * Make an outbound call via Twilio (operator account).
 * Usage: node scripts/make-outbound-call.js <phone_number>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../database');
const { getOperatorCustomerId } = require('../services/voice/voice-account-resolution');
const { initiateOutboundCall } = require('../services/platform/outbound-call-service');
const {
  ensureOperatorTenantBootstrap,
  resolveVoiceMerchantId
} = require('../services/shared/operator-tenant-bootstrap');

const phoneNumber = process.argv[2];
const appointmentIdArg = (() => {
  const i = process.argv.indexOf('--appointment-id');
  return i > -1 ? process.argv[i + 1] : process.env.OUTBOUND_APPOINTMENT_ID || null;
})();
const outboundPurpose = (() => {
  const i = process.argv.indexOf('--purpose');
  return i > -1 ? process.argv[i + 1] : process.env.OUTBOUND_PURPOSE || null;
})();

if (!phoneNumber || phoneNumber.startsWith('--')) {
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
    const operatorCustomerId = getOperatorCustomerId();
    if (!operatorCustomerId) {
      throw new Error('CALLSOMO_OPERATOR_CUSTOMER_ID or CALLSOMO_VOICE_CUSTOMER_ID not configured');
    }

    ensureOperatorTenantBootstrap(db, operatorCustomerId);
    const customer = db.getCustomer(operatorCustomerId);
    const merchantId = resolveVoiceMerchantId(db, customer);
    if (!merchantId) {
      throw new Error('Could not resolve operator merchant context');
    }

    const toNumber = formatPhoneNumber(phoneNumber);
    const agentId = process.env.RETELL_AGENT_ID || process.env.RETELL_SALES_AGENT_ID;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    console.log('📞 Making operator outbound call...');
    console.log(`   From: ${fromNumber}`);
    console.log(`   To: ${toNumber}`);
    console.log(`   Agent: ${agentId}`);
    console.log(`   Operator customer: ${operatorCustomerId}`);
    console.log(`   Merchant: ${merchantId}`);
    console.log('');

    const result = await initiateOutboundCall({
      phone_number: toNumber,
      merchantId,
      customer_id: operatorCustomerId,
      call_type: 'operator_outbound',
      appointment_id: appointmentIdArg,
      outbound_purpose: outboundPurpose || (appointmentIdArg ? 'appointment_reminder' : null)
    });

    console.log('✅ Call initiated successfully!');
    console.log(`   Call SID: ${result.call_id}`);
    console.log(`   Provider: ${result.provider}`);
  } catch (error) {
    console.error('❌ Failed to make call:', error.message);
    process.exit(1);
  }
}

makeCall();
