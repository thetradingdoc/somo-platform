#!/usr/bin/env node
/**
 * Test Outbound Call Script
 * 
 * Tests if the voice agent can make outbound calls via Retell API
 * 
 * Usage:
 *   node scripts/test-outbound-call.js <phone_number>
 * 
 * Example:
 *   node scripts/test-outbound-call.js +18622307479
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const RetellService = require('../services/retell-service');

async function testOutboundCall() {
  console.log('\n📞 TESTING OUTBOUND CALL FUNCTIONALITY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get phone number from command line argument
  const toNumber = process.argv[2];
  if (!toNumber) {
    console.error('❌ Error: Phone number required');
    console.log('\nUsage: node scripts/test-outbound-call.js <phone_number>');
    console.log('Example: node scripts/test-outbound-call.js +18622307479');
    process.exit(1);
  }

  // Validate phone number format
  let formattedToNumber = toNumber.trim();
  if (!formattedToNumber.startsWith('+')) {
    // Assume US number if no country code
    if (formattedToNumber.length === 10) {
      formattedToNumber = `+1${formattedToNumber}`;
    } else {
      formattedToNumber = `+${formattedToNumber}`;
    }
  }

  // Check required environment variables
  const retellApiKey = process.env.RETELL_API_KEY;
  const retellAgentId = process.env.RETELL_SALES_AGENT_ID || process.env.RETELL_AGENT_ID;
  const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

  console.log('📋 Configuration Check:');
  console.log(`   RETELL_API_KEY: ${retellApiKey ? '✅ Set' : '❌ Missing'}`);
  console.log(`   RETELL_AGENT_ID: ${retellAgentId ? `✅ Set (${retellAgentId})` : '❌ Missing'}`);
  console.log(`   TWILIO_PHONE_NUMBER: ${twilioPhoneNumber ? `✅ Set (${twilioPhoneNumber})` : '❌ Missing'}`);
  console.log();

  if (!retellApiKey) {
    console.error('❌ RETELL_API_KEY is required. Please set it in your .env file.');
    process.exit(1);
  }

  if (!retellAgentId) {
    console.error('❌ RETELL_SALES_AGENT_ID or RETELL_AGENT_ID is required. Please set it in your .env file.');
    process.exit(1);
  }

  if (!twilioPhoneNumber) {
    console.error('❌ TWILIO_PHONE_NUMBER is required. Please set it in your .env file.');
    process.exit(1);
  }

  // Initialize Retell service
  const retellService = new RetellService();

  console.log('📞 Call Details:');
  console.log(`   From: ${twilioPhoneNumber}`);
  console.log(`   To: ${formattedToNumber}`);
  console.log(`   Agent ID: ${retellAgentId}`);
  console.log();

  try {
    console.log('🚀 Initiating outbound call...\n');

    const result = await retellService.createOutboundCall(
      retellAgentId,
      twilioPhoneNumber,
      formattedToNumber,
      {
        override_agent_id: retellAgentId,
        retell_llm_dynamic_variables: {
          call_purpose: 'Testing outbound call functionality'
        },
        metadata: {
          test: true,
          call_type: 'test_outbound'
        }
      }
    );

    console.log('\n✅ SUCCESS! Outbound call initiated');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Call ID: ${result.call_id}`);
    console.log(`   Status: ${result.call_data?.status || 'initiated'}`);
    console.log();
    console.log('📊 Full Response:');
    console.log(JSON.stringify(result.call_data, null, 2));
    console.log();
    console.log('💡 Next Steps:');
    console.log('   1. Check your phone - you should receive a call');
    console.log('   2. Answer the call and interact with the voice agent');
    console.log('   3. Check Retell dashboard for call details');
    console.log('   4. Check Twilio console for call logs');
    console.log();

  } catch (error) {
    console.error('\n❌ FAILED to initiate outbound call');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(`   Error: ${error.message}`);
    
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Response:`, JSON.stringify(error.response.data, null, 2));
    }
    
    console.error();
    console.error('🔍 Troubleshooting:');
    console.error('   1. Verify RETELL_API_KEY is correct');
    console.error('   2. Verify RETELL_AGENT_ID exists and is active');
    console.error('   3. Verify TWILIO_PHONE_NUMBER is imported in Retell');
    console.error('   4. Check Retell dashboard for SIP trunk configuration');
    console.error('   5. Verify phone number format (E.164: +1234567890)');
    console.error();
    
    process.exit(1);
  }
}

// Run the test
testOutboundCall().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

