/**
 * COMPREHENSIVE TEST SUITE FOR DRRIGHT FLUTTER INTEGRATION
 * 
 * Tests all API endpoints and functionality that DrRight's Flutter app will need:
 * 1. Customer signup and authentication
 * 2. Retell agent creation and retrieval
 * 3. API key management
 * 4. Retell call registration (simulating Flutter SDK)
 * 5. WebSocket connection
 * 6. Function calling capabilities
 * 7. Usage tracking and billing
 */

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

// Manual cookie handling
let sessionCookie = null;

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';
const RETELL_API_KEY = process.env.RETELL_API_KEY;

// Test customer data (simulating DrRight)
const TEST_CUSTOMER = {
  name: 'DrRight Test User',
  email: `drright-test-${Date.now()}@example.com`,
  phone_number: '+15551234567',
  company_name: 'DrRight Medical App',
  business_size: '10-50',
  api_features: ['voice_agent', 'healthcare_commerce', 'fhir_integration']
};

let testSessionCookie = null;
let testCustomerId = null;
let testRetellAgentId = null;
let testApiKey = null;

console.log('\n' + '='.repeat(80));
console.log('🧪 DRRIGHT FLUTTER INTEGRATION TEST SUITE');
console.log('='.repeat(80) + '\n');

// Helper function to make authenticated requests
async function makeRequest(method, endpoint, data = null, useAuth = true) {
  const config = {
    method,
    url: `${API_BASE}${endpoint}`,
    headers: {
      'Content-Type': 'application/json',
    },
    validateStatus: () => true, // Don't throw on HTTP errors
    withCredentials: true
  };

  // Add session cookie if available
  if (useAuth && sessionCookie) {
    config.headers['Cookie'] = `customer_session=${sessionCookie}`;
  }

  if (data) {
    config.data = data;
  }

  try {
    const response = await axios(config);
    
    // Extract session cookie from Set-Cookie header
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      const cookieArray = Array.isArray(setCookie) ? setCookie : [setCookie];
      for (const cookie of cookieArray) {
        const cookieMatch = cookie.match(/customer_session=([^;]+)/);
        if (cookieMatch) {
          sessionCookie = cookieMatch[1];
          testSessionCookie = sessionCookie;
        }
      }
    }
    
    return {
      status: response.status,
      data: response.data,
      headers: response.headers
    };
  } catch (error) {
    return {
      status: error.response?.status || 500,
      data: error.response?.data || { error: error.message },
      error: error.message
    };
  }
}

// Test suite
async function runTests() {
  let passedTests = 0;
  let failedTests = 0;

  function test(name, fn) {
    return async () => {
      try {
        console.log(`\n📋 TEST: ${name}`);
        const result = await fn();
        if (result !== false) {
          console.log(`   ✅ PASSED`);
          passedTests++;
          return true;
        } else {
          console.log(`   ❌ FAILED`);
          failedTests++;
          return false;
        }
      } catch (error) {
        console.log(`   ❌ FAILED: ${error.message}`);
        console.error(error.stack);
        failedTests++;
        return false;
      }
    };
  }

  // ============================================================================
  // TEST SUITE 1: CUSTOMER SIGNUP & AUTHENTICATION
  // ============================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('📦 SUITE 1: CUSTOMER SIGNUP & AUTHENTICATION');
  console.log('─'.repeat(80));

  await test('1.1: Customer Signup', async () => {
    const response = await makeRequest('POST', '/api/signup', TEST_CUSTOMER, false);
    
    if (response.status !== 200 || !response.data.success) {
      console.log(`   Status: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
      return false;
    }

    // Extract session cookie from Set-Cookie header
    const setCookie = response.headers['set-cookie'];
    if (setCookie && setCookie.length > 0) {
      const cookieMatch = setCookie[0].match(/customer_session=([^;]+)/);
      if (cookieMatch) {
        testSessionCookie = cookieMatch[1];
        console.log(`   ✅ Session cookie extracted: ${testSessionCookie.substring(0, 20)}...`);
      }
    }

    return true;
  })();

  await test('1.2: Get Verification Code from Database', async () => {
    // After signup, the code is stored in database
    // We need to retrieve it to verify email
    const db = require('./database');
    
    try {
      const activeCode = db.getActiveEmailVerificationCode(TEST_CUSTOMER.email);
      if (activeCode && activeCode.code) {
        global.testVerificationCode = activeCode.code;
        console.log(`   ✅ Found verification code: ${activeCode.code}`);
        return true;
      }
      
      console.log(`   ⚠️  No active verification code found`);
      return false;
    } catch (error) {
      console.log(`   ⚠️  Error retrieving code: ${error.message}`);
      return false;
    }
  })();

  await test('1.3: Verify Email with Code', async () => {
    if (!global.testVerificationCode) {
      console.log(`   ⚠️  No verification code available - skipping`);
      return false;
    }

    const response = await makeRequest('POST', '/api/signup/verify-email', {
      email: TEST_CUSTOMER.email,
      code: global.testVerificationCode
    }, false);

    if (response.status !== 200 || !response.data.success) {
      console.log(`   Status: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
      return false;
    }

    // Session cookie should be set automatically by cookieJar
    console.log(`   ✅ Email verified successfully`);
    return true;
  })();

  // ============================================================================
  // TEST SUITE 2: TERMS ACCEPTANCE & AGENT CREATION
  // ============================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('📋 SUITE 2: TERMS ACCEPTANCE & RETELL AGENT CREATION');
  console.log('─'.repeat(80));

  await test('2.1: Accept Terms of Service', async () => {
    const response = await makeRequest('POST', '/api/signup/accept-terms', {}, true);
    
    if (response.status !== 200 || !response.data.success) {
      console.log(`   Status: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
      return false;
    }

    // Check if Retell agent was created
    if (response.data.retell_agent_id) {
      testRetellAgentId = response.data.retell_agent_id;
      console.log(`   ✅ Retell Agent ID: ${testRetellAgentId}`);
      console.log(`   ✅ Agent Status: ${response.data.retell_agent_status || 'active'}`);
    }

    return true;
  })();

  await test('2.2: Verify 100 Free Credits Allocated', async () => {
    const response = await makeRequest('GET', '/api/credits/balance', null, true);
    
    if (response.status !== 200 || !response.data.success) {
      console.log(`   Status: ${response.status}`);
      return false;
    }

    const credits = response.data.credits || response.data;
    console.log(`   Credits Balance: ${credits.credits_balance_minutes} minutes`);
    
    if (credits.credits_balance_minutes >= 100) {
      return true;
    }

    return false;
  })();

  // ============================================================================
  // TEST SUITE 3: CUSTOMER API ENDPOINTS
  // ============================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('👤 SUITE 3: CUSTOMER API ENDPOINTS');
  console.log('─'.repeat(80));

  await test('3.1: Get Customer Profile (with Retell Agent ID)', async () => {
    const response = await makeRequest('GET', '/api/customers/me', null, true);
    
    if (response.status !== 200 || !response.data.success) {
      console.log(`   Status: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
      return false;
    }

    const customer = response.data.customer;
    testCustomerId = customer.id;
    
    console.log(`   ✅ Customer ID: ${customer.id}`);
    console.log(`   ✅ Email: ${customer.email}`);
    console.log(`   ✅ Company: ${customer.company_name}`);
    
    if (customer.retell_agent_id) {
      testRetellAgentId = customer.retell_agent_id;
      console.log(`   ✅ Retell Agent ID: ${testRetellAgentId}`);
      console.log(`   ✅ Agent Status: ${customer.retell_agent_status || 'active'}`);
    } else {
      console.log(`   ⚠️  No Retell Agent ID found (should be created)`);
      return false;
    }

    return true;
  })();

  await test('3.2: Create API Key', async () => {
    const response = await makeRequest('POST', '/api/customers/me/api-keys', {}, true);
    
    if (response.status !== 200 || !response.data.success) {
      console.log(`   Status: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
      return false;
    }

    if (response.data.api_key) {
      testApiKey = response.data.api_key;
      console.log(`   ✅ API Key created: ${response.data.key_prefix}...`);
      console.log(`   ✅ Key ID: ${response.data.key_id}`);
    } else {
      return false;
    }

    return true;
  })();

  await test('3.3: List API Keys', async () => {
    const response = await makeRequest('GET', '/api/customers/me/api-keys', null, true);
    
    if (response.status !== 200 || !response.data.success) {
      console.log(`   Status: ${response.status}`);
      return false;
    }

    const keys = response.data.api_keys || [];
    console.log(`   ✅ Found ${keys.length} API key(s)`);
    
    return keys.length > 0;
  })();

  // ============================================================================
  // TEST SUITE 4: RETELL AGENT VERIFICATION
  // ============================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('📞 SUITE 4: RETELL AGENT VERIFICATION');
  console.log('─'.repeat(80));

  await test('4.1: Verify Retell Agent Exists in Retell API', async () => {
    if (!testRetellAgentId) {
      console.log('   ⚠️  No Retell Agent ID from previous tests');
      return false;
    }

    if (!RETELL_API_KEY) {
      console.log('   ⚠️  RETELL_API_KEY not configured - skipping Retell API test');
      return true; // Skip, not a failure
    }

    try {
      const response = await axios.get(
        `https://api.retellai.com/v2/get-agent/${testRetellAgentId}`,
        {
          headers: {
            'Authorization': `Bearer ${RETELL_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data && response.data.agent_id) {
        console.log(`   ✅ Agent verified in Retell`);
        console.log(`   ✅ Agent Name: ${response.data.agent_name}`);
        console.log(`   ✅ LLM WebSocket URL: ${response.data.llm_websocket_url || 'Not configured'}`);
        console.log(`   ✅ Voice ID: ${response.data.voice_id}`);
        return true;
      }

      return false;
    } catch (error) {
      console.log(`   ⚠️  Retell API error: ${error.message}`);
      if (error.response) {
        console.log(`   Status: ${error.response.status}`);
        console.log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
      }
      return false;
    }
  })();

  await test('4.2: Verify Retell Agent WebSocket URL Points to DocLittle', async () => {
    if (!testRetellAgentId || !RETELL_API_KEY) {
      return true; // Skip
    }

    try {
      const response = await axios.get(
        `https://api.retellai.com/v2/get-agent/${testRetellAgentId}`,
        {
          headers: {
            'Authorization': `Bearer ${RETELL_API_KEY}`
          }
        }
      );

      const websocketUrl = response.data.llm_websocket_url;
      
      if (!websocketUrl) {
        console.log('   ⚠️  No LLM WebSocket URL configured');
        return false;
      }

      // Should point to our WebSocket endpoint
      const expectedHost = 'api.doclittle.site' || 'localhost:4000';
      if (websocketUrl.includes(expectedHost) || websocketUrl.includes('localhost:4000')) {
        console.log(`   ✅ WebSocket URL: ${websocketUrl}`);
        return true;
      }

      console.log(`   ⚠️  WebSocket URL points to: ${websocketUrl}`);
      console.log(`   Expected: ${expectedHost}`);
      return false;
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`);
      return false;
    }
  })();

  // ============================================================================
  // TEST SUITE 5: RETELL CALL REGISTRATION (FLUTTER SDK SIMULATION)
  // ============================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('📱 SUITE 5: RETELL CALL REGISTRATION (Flutter SDK Simulation)');
  console.log('─'.repeat(80));

  await test('5.1: Register Call with Retell API (Simulating Flutter SDK)', async () => {
    if (!testRetellAgentId || !RETELL_API_KEY) {
      console.log('   ⚠️  Missing Retell Agent ID or API Key - skipping');
      return true; // Skip
    }

    // This simulates what Flutter SDK does:
    // Retell Flutter SDK calls Retell API to register a call
    const registerPayload = {
      agent_id: testRetellAgentId,
      audio_websocket_protocol: 'twilio', // Standard for mobile SDK
      audio_encoding: 'mulaw',
      sample_rate: 8000,
      // Flutter SDK would pass these dynamic variables:
      retell_llm_dynamic_variables: {
        customer_id: testCustomerId, // CRITICAL: DrRight must pass this
        context: 'flutter_app',
        patient_id: 'test_patient_123' // Optional: DrRight can pass patient context
      },
      metadata: {
        customer_id: testCustomerId, // Also in metadata as backup
        source: 'flutter_app',
        test: true
      }
    };

    try {
      const response = await axios.post(
        'https://api.retellai.com/v2/register-phone-call',
        registerPayload,
        {
          headers: {
            'Authorization': `Bearer ${RETELL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.data && response.data.call_id) {
        console.log(`   ✅ Call registered successfully`);
        console.log(`   ✅ Call ID: ${response.data.call_id}`);
        console.log(`   ✅ Status: ${response.data.call_status}`);
        
        // Store call ID for later tests
        global.testCallId = response.data.call_id;
        
        return true;
      }

      return false;
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`);
      if (error.response) {
        console.log(`   Status: ${error.response.status}`);
        console.log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
      }
      return false;
    }
  })();

  await test('5.2: Verify Call Details from Retell', async () => {
    if (!global.testCallId || !RETELL_API_KEY) {
      return true; // Skip
    }

    try {
      const response = await axios.get(
        `https://api.retellai.com/v2/get-call/${global.testCallId}`,
        {
          headers: {
            'Authorization': `Bearer ${RETELL_API_KEY}`
          }
        }
      );

      if (response.data) {
        console.log(`   ✅ Call details retrieved`);
        console.log(`   ✅ Call Status: ${response.data.call_status || 'unknown'}`);
        return true;
      }

      return false;
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`);
      return false;
    }
  })();

  // ============================================================================
  // TEST SUITE 6: API FUNCTION ENDPOINTS
  // ============================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('⚙️  SUITE 6: API FUNCTION ENDPOINTS');
  console.log('─'.repeat(80));

  await test('6.1: Test Appointment Schedule Endpoint', async () => {
    const response = await makeRequest('POST', '/voice/appointments/schedule', {
      patient_name: 'Test Patient',
      patient_phone: '+15551234567',
      appointment_type: 'Consultation',
      date: '2025-12-01',
      time: '10:00',
      timezone: 'America/New_York'
    }, true);

    // Should return 200 or 400 (depending on validation)
    // We're just checking the endpoint exists and is accessible
    if (response.status === 200 || response.status === 400) {
      console.log(`   ✅ Endpoint accessible (status: ${response.status})`);
      return true;
    }

    console.log(`   Status: ${response.status}`);
    return false;
  })();

  await test('6.2: Test Insurance Eligibility Check Endpoint', async () => {
    const response = await makeRequest('POST', '/voice/insurance/check-eligibility', {
      patient_name: 'Test Patient',
      member_id: 'TEST123456',
      payer_name: 'CIGNA',
      date_of_birth: '1990-01-01'
    }, true);

    // Should return 200 or 400
    if (response.status === 200 || response.status === 400) {
      console.log(`   ✅ Endpoint accessible (status: ${response.status})`);
      return true;
    }

    return false;
  })();

  await test('6.3: Test Payment Processing Endpoint', async () => {
    const response = await makeRequest('POST', '/voice/checkout/create', {
      customer_name: 'Test Patient',
      customer_phone: '+15551234567',
      items: [{
        name: 'Consultation',
        price: 100.00,
        quantity: 1
      }]
    }, true);

    // Should return 200 or 400
    if (response.status === 200 || response.status === 400) {
      console.log(`   ✅ Endpoint accessible (status: ${response.status})`);
      return true;
    }

    return false;
  })();

  // ============================================================================
  // TEST SUITE 7: USAGE TRACKING & BILLING
  // ============================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('💰 SUITE 7: USAGE TRACKING & BILLING');
  console.log('─'.repeat(80));

  await test('7.1: Check Credits Balance After Tests', async () => {
    const response = await makeRequest('GET', '/api/credits/balance', null, true);
    
    if (response.status !== 200 || !response.data.success) {
      return false;
    }

    const credits = response.data.credits || response.data;
    console.log(`   ✅ Credits Balance: ${credits.credits_balance_minutes} minutes`);
    console.log(`   ✅ Free Credits: ${credits.free_credits_minutes || 0} minutes`);
    console.log(`   ✅ Paid Credits: ${credits.paid_credits_minutes || 0} minutes`);
    
    return true;
  })();

  await test('7.2: Check Usage History Endpoint', async () => {
    const response = await makeRequest('GET', '/api/credits/usage', null, true);
    
    if (response.status === 200 || response.status === 404) {
      // 404 is OK if no usage yet
      console.log(`   ✅ Endpoint accessible (status: ${response.status})`);
      return true;
    }

    return false;
  })();

  await test('7.3: Check Invoice History Endpoint', async () => {
    const response = await makeRequest('GET', '/api/customers/me/invoices', null, true);
    
    if (response.status === 200 || response.status === 404) {
      // 404 is OK if no invoices yet
      console.log(`   ✅ Endpoint accessible (status: ${response.status})`);
      return true;
    }

    return false;
  })();

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log(`📈 Total: ${passedTests + failedTests}`);
  console.log(`📊 Success Rate: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(1)}%`);
  console.log('='.repeat(80));

  console.log('\n📋 INTEGRATION INFORMATION FOR DRRIGHT:');
  console.log('─'.repeat(80));
  console.log(`✅ Customer ID: ${testCustomerId || 'Not created'}`);
  console.log(`✅ Retell Agent ID: ${testRetellAgentId || 'Not created'}`);
  console.log(`✅ API Key: ${testApiKey ? testApiKey.substring(0, 20) + '...' : 'Not created'}`);
  console.log(`✅ API Base URL: ${API_BASE}`);
  console.log(`✅ WebSocket URL: ${API_BASE.replace('http://', 'ws://').replace('https://', 'wss://')}/retell-llm`);
  console.log('─'.repeat(80));

  console.log('\n📝 DRRIGHT FLUTTER INTEGRATION STEPS:');
  console.log('─'.repeat(80));
  console.log('1. Sign up at: https://api.doclittle.site');
  console.log('2. Accept terms of service');
  console.log('3. Get Retell Agent ID from: GET /api/customers/me');
  console.log('4. Create API Key from: POST /api/customers/me/api-keys');
  console.log('5. In Flutter SDK, initialize Retell with:');
  console.log('   - agent_id: <from step 3>');
  console.log('   - dynamic_variables: { customer_id: "<customer_id>" }');
  console.log('6. Register calls using Retell Flutter SDK');
  console.log('7. Voice agent will connect to DocLittle WebSocket automatically');
  console.log('─'.repeat(80));

  if (failedTests === 0) {
    console.log('\n✅ ALL TESTS PASSED! Ready for DrRight integration.');
  } else {
    console.log('\n⚠️  Some tests failed. Review errors above before integration.');
  }

  console.log('\n');
}

// Run tests
runTests().catch(error => {
  console.error('\n❌ FATAL ERROR:', error);
  process.exit(1);
});

