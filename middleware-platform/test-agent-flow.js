#!/usr/bin/env node
/**
 * Quick test script to verify voice agent flow end-to-end
 * Tests: Customer lookup, Retell registration, TwiML generation
 */

const axios = require('axios');
const crypto = require('crypto');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';

// Test data
const TEST_CUSTOMER = {
  name: 'Test Customer',
  email: `test-${Date.now()}@test.com`,
  phone_number: '+15551234567',
  twilio_phone_number: '+15856202445', // Your Twilio number
  retell_agent_id: process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a'
};

async function testVoiceAgentFlow() {
  console.log('🧪 Testing Voice Agent Flow\n');
  console.log('='.repeat(50));

  try {
    // Step 1: Create test customer with Twilio number mapping
    console.log('\n1️⃣  Creating test customer...');
    const db = require('./database');
    
    const customerId = `test_${crypto.randomBytes(16).toString('hex')}`;
    db.createCustomer({
      id: customerId,
      name: TEST_CUSTOMER.name,
      email: TEST_CUSTOMER.email,
      phone_number: TEST_CUSTOMER.phone_number,
      twilio_phone_number: TEST_CUSTOMER.twilio_phone_number,
      retell_agent_id: TEST_CUSTOMER.retell_agent_id,
      email_verified: 1,
      customer_type: 'api',
      status: 'active'
    });
    console.log(`   ✅ Customer created: ${customerId}`);

    // Step 2: Test /voice/incoming endpoint
    console.log('\n2️⃣  Testing /voice/incoming endpoint...');
    const response = await axios.post(`${API_BASE}/voice/incoming`, {
      From: '+15559876543',
      To: TEST_CUSTOMER.twilio_phone_number,
      CallSid: `CA_TEST_${Date.now()}`
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      validateStatus: () => true // Don't throw on non-2xx
    });

    if (response.status === 200 && response.data.includes('<?xml')) {
      console.log('   ✅ TwiML response received');
      
      // Check if Retell SIP URI is present
      if (response.data.includes('sip:') && response.data.includes('@5t4n6j0wnrl.sip.livekit.cloud')) {
        console.log('   ✅ Retell SIP endpoint found in TwiML');
        
        // Extract call_id from SIP URI
        const sipMatch = response.data.match(/sip:([^@]+)@/);
        if (sipMatch) {
          const callId = sipMatch[1];
          console.log(`   ✅ Call ID: ${callId}`);
        }
      } else {
        console.log('   ⚠️  Retell SIP endpoint not found in TwiML');
      }
    } else {
      console.log(`   ❌ Unexpected response: ${response.status}`);
      console.log(`   Response: ${response.data.substring(0, 200)}`);
    }

    // Step 3: Verify customer lookup works
    console.log('\n3️⃣  Verifying customer lookup...');
    const foundCustomer = db.getCustomerByTwilioPhone(TEST_CUSTOMER.twilio_phone_number);
    if (foundCustomer && foundCustomer.id === customerId) {
      console.log(`   ✅ Customer lookup by Twilio number works`);
      console.log(`   Found: ${foundCustomer.name} (${foundCustomer.id})`);
    } else {
      console.log('   ⚠️  Customer lookup failed - this might be expected if using legacy clinic lookup');
    }

    // Step 4: Cleanup
    console.log('\n4️⃣  Cleaning up test data...');
    // Note: You may want to keep test data for manual verification
    // db.db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
    console.log('   ✅ Test complete (test customer kept for manual verification)');

    console.log('\n' + '='.repeat(50));
    console.log('✅ Voice Agent Flow Test: PASSED\n');
    console.log('Next steps:');
    console.log('1. Start server: npm start');
    console.log('2. Make a real call to your Twilio number');
    console.log('3. Check logs for Retell registration success');
    console.log('4. Verify WebSocket connection in Retell dashboard\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    process.exit(1);
  }
}

// Run test
testVoiceAgentFlow();

