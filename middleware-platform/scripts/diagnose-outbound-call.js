#!/usr/bin/env node
/**
 * Comprehensive Outbound Call Diagnostic Script
 * 
 * This script tests all components of the outbound calling system
 * to identify where failures are occurring.
 * 
 * Usage:
 *   node scripts/diagnose-outbound-call.js +18622307479
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false
});

const axios = require('axios');
const twilio = require('twilio');
const RetellService = require('../services/retell-service');
const db = require('../database');
const { v4: uuidv4 } = require('uuid');

const TARGET_PHONE = process.argv[2] || '+18622307479';
const DEBUG_RUN_ID = `diag-${Date.now()}`;

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60));
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

async function testEnvironmentVariables() {
  logSection('1. Environment Variables Check');
  
  const required = [
    'RETELL_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER'
  ];
  
  const important = [
    'RETELL_SALES_AGENT_ID',
    'RETELL_AGENT_ID',
    'API_BASE_URL'
  ];
  
  const optional = [
    'RETELL_WEBHOOK_SECRET',
    'RETELL_LLM_WEBSOCKET_URL'
  ];
  
  let allPresent = true;
  
  for (const key of required) {
    if (process.env[key]) {
      logSuccess(`${key}: ${process.env[key].substring(0, 20)}...`);
    } else {
      logError(`${key}: NOT SET`);
      allPresent = false;
    }
  }
  
  for (const key of important) {
    if (process.env[key]) {
      logSuccess(`${key}: ${process.env[key].substring(0, 30)}...`);
    } else {
      logWarning(`${key}: NOT SET (will use fallback if available)`);
      // Check for fallbacks
      if (key === 'RETELL_SALES_AGENT_ID' && process.env.RETELL_AGENT_ID) {
        logInfo(`  → Using RETELL_AGENT_ID as fallback`);
      }
      if (key === 'API_BASE_URL') {
        logInfo(`  → Will use default: https://api.callsomo.com`);
      }
    }
  }
  
  for (const key of optional) {
    if (process.env[key]) {
      logInfo(`${key}: ${process.env[key].substring(0, 30)}...`);
    } else {
      logWarning(`${key}: Not set (optional)`);
    }
  }
  
  return allPresent;
}

async function testRetellAPI() {
  logSection('2. Retell API Connectivity');
  
  try {
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) {
      logError('RETELL_API_KEY not configured');
      return false;
    }
    
    // Test API key by getting agent info
    const salesAgentId = process.env.RETELL_SALES_AGENT_ID || process.env.RETELL_AGENT_ID;
    if (!salesAgentId) {
      logError('RETELL_SALES_AGENT_ID or RETELL_AGENT_ID not configured');
      return false;
    }
    
    logInfo(`Testing Retell API with agent: ${salesAgentId}`);
    
    const response = await axios.get(
      `https://api.retellai.com/get-agent/${salesAgentId}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 10000
      }
    );
    
    if (response.data) {
      logSuccess('Retell API is accessible');
      logInfo(`Agent Name: ${response.data.agent_name || 'N/A'}`);
      logInfo(`Agent Version: ${response.data.agent_version || 'N/A'}`);
      const wsUrl =
        response.data.response_engine?.llm_websocket_url ||
        response.data.llm_websocket_url ||
        'N/A';
      logInfo(`WebSocket URL: ${wsUrl}`);
      try {
        const phonesResp = await axios.get('https://api.retellai.com/v2/list-phone-numbers', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          timeout: 10000
        });
        const items = Array.isArray(phonesResp.data?.items) ? phonesResp.data.items : [];
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;
        const matched = items.find((i) => i.phone_number === fromNumber);
      } catch (_) {}
      return true;
    }
  } catch (error) {
    logError(`Retell API test failed: ${error.message}`);
    if (error.response) {
      logError(`Status: ${error.response.status}`);
      logError(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return false;
  }
}

async function testTwilioConfiguration() {
  logSection('3. Twilio Configuration');
  
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    
    if (!accountSid || !authToken) {
      logError('Twilio credentials not configured');
      return false;
    }
    
    logInfo('Testing Twilio API connectivity...');
    
    const client = twilio(accountSid, authToken);
    
    // Test by fetching account info
    const account = await client.api.accounts(accountSid).fetch();
    logSuccess('Twilio API is accessible');
    logInfo(`Account Status: ${account.status}`);
    logInfo(`Account Type: ${account.type}`);
    
    // Check phone number
    if (fromNumber) {
      logInfo(`From Number: ${fromNumber}`);
      try {
        const incomingNumbers = await client.incomingPhoneNumbers.list({ phoneNumber: fromNumber });
        if (incomingNumbers.length > 0) {
          const number = incomingNumbers[0];
          logSuccess(`Phone number is active: ${number.phoneNumber}`);
          logInfo(`Number SID: ${number.sid}`);
          logInfo(`Number Capabilities: Voice=${number.capabilities.voice}, SMS=${number.capabilities.sms}`);
        } else {
          logWarning(`Phone number ${fromNumber} not found in account`);
        }
      } catch (err) {
        logError(`Failed to check phone number: ${err.message}`);
      }
    }
    try {
      const trunkSid = 'TKef81908ba0a83bb52eff902076f5abfc';
      const [credentialLists, ipAccessControlLists] = await Promise.all([
        client.trunking.v1.trunks(trunkSid).credentialLists.list(),
        client.trunking.v1.trunks(trunkSid).ipAccessControlLists.list()
      ]);
    } catch (_) {}
    
    return true;
  } catch (error) {
    logError(`Twilio test failed: ${error.message}`);
    if (error.code) {
      logError(`Twilio Error Code: ${error.code}`);
    }
    return false;
  }
}

async function testRetellAgentConfiguration() {
  logSection('4. Retell Agent Configuration');
  
  try {
    const retellService = new RetellService();
    const salesAgentId = process.env.RETELL_SALES_AGENT_ID || process.env.RETELL_AGENT_ID;
    
    if (!salesAgentId) {
      logError('Sales agent ID not configured');
      return false;
    }
    
    logInfo(`Checking agent: ${salesAgentId}`);
    
    // Load sales prompt
    const salesPrompt = retellService.loadSalesPrompt();
    if (salesPrompt) {
      logSuccess('Sales prompt loaded');
      logInfo(`Prompt length: ${salesPrompt.length} characters`);
    } else {
      logWarning('Sales prompt not found, using default');
    }
    
    // Load sales functions
    const salesFunctions = retellService.loadSalesAgentFunctions();
    if (salesFunctions && salesFunctions.length > 0) {
      logSuccess(`Sales functions loaded: ${salesFunctions.length} functions`);
      salesFunctions.forEach(fn => {
        logInfo(`  - ${fn.name}: ${fn.description}`);
      });
    } else {
      logWarning('No sales functions found');
    }
    
    // Try to update agent
    logInfo('Updating agent configuration...');
    const updateResult = await retellService.updateAgent(salesAgentId, {
      system_prompt: salesPrompt,
      agent_name: 'Somo Sales Agent - Alex',
      functions: salesFunctions
    });
    
    if (updateResult.success) {
      logSuccess('Agent configuration updated successfully');
      return true;
    } else {
      logError(`Agent update failed: ${updateResult.error}`);
      return false;
    }
  } catch (error) {
    logError(`Agent configuration test failed: ${error.message}`);
    return false;
  }
}

async function testOutboundCallCreation() {
  logSection('5. Outbound Call Creation Test');
  
  try {
    const retellService = new RetellService();
    const salesAgentId = process.env.RETELL_SALES_AGENT_ID || process.env.RETELL_AGENT_ID;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    
    if (!salesAgentId || !fromNumber) {
      logError('Missing required configuration');
      return null;
    }
    
    logInfo(`Creating outbound call:`);
    logInfo(`  From: ${fromNumber}`);
    logInfo(`  To: ${TARGET_PHONE}`);
    logInfo(`  Agent: ${salesAgentId}`);
    
    const dynamicVariables = {
      clinic_name: 'Test Clinic',
      lead_id: 'test-diagnostic',
      job_title: 'Decision Maker',
      location: 'Test Location',
      specialty: 'General',
      lead_source: 'diagnostic_test'
    };
    
    const startTime = Date.now();
    const result = await retellService.createOutboundCall(
      salesAgentId,
      fromNumber,
      TARGET_PHONE,
      {
        override_agent_id: salesAgentId,
        retell_llm_dynamic_variables: dynamicVariables,
        metadata: {
          call_type: 'sales_outbound',
          test_mode: 'diagnostic'
        }
      }
    );
    
    const elapsed = Date.now() - startTime;
    
    if (result.success && result.call_id) {
      logSuccess(`Call created successfully!`);
      logInfo(`Call ID: ${result.call_id}`);
      logInfo(`Response time: ${elapsed}ms`);
      return result.call_id;
    } else {
      logError('Call creation failed');
      if (result.error) {
        logError(`Error: ${result.error}`);
      }
      return null;
    }
  } catch (error) {
    logError(`Outbound call creation failed: ${error.message}`);
    if (error.response) {
      logError(`Status: ${error.response.status}`);
      logError(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return null;
  }
}

async function monitorCallStatus(callId, duration = 10000) {
  logSection('6. Call Status Monitoring');
  
  if (!callId) {
    logWarning('No call ID to monitor');
    return;
  }
  
  logInfo(`Monitoring call: ${callId}`);
  logInfo(`Duration: ${duration / 1000} seconds`);
  
  const apiKey = process.env.RETELL_API_KEY;
  const startTime = Date.now();
  const checkInterval = 2000; // Check every 2 seconds
  let lastStatus = null;
  
  while (Date.now() - startTime < duration) {
    try {
      const response = await axios.get(
        `https://api.retellai.com/v2/get-call/${callId}`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 5000
        }
      );
      
      const callData = response.data;
      const currentStatus = callData.call_status;
      
      if (currentStatus !== lastStatus) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logInfo(`[${elapsed}s] Status changed: ${lastStatus || 'initial'} → ${currentStatus}`);
        lastStatus = currentStatus;
        
        if (callData.disconnection_reason) {
          logWarning(`Disconnection Reason: ${callData.disconnection_reason}`);
        }
        
        if (callData.duration_ms) {
          logInfo(`Duration: ${(callData.duration_ms / 1000).toFixed(2)}s`);
        }
        
        // Check if call is connected
        if (currentStatus === 'connected' || currentStatus === 'ended') {
          logSuccess(`Call ${currentStatus}!`);
          break;
        }
        
        // Check if call failed
        if (currentStatus === 'not_connected' || currentStatus === 'failed') {
          logError(`Call failed with status: ${currentStatus}`);
          if (callData.disconnection_reason) {
            logError(`Reason: ${callData.disconnection_reason}`);
          }
          break;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    } catch (error) {
      logError(`Error checking call status: ${error.message}`);
      break;
    }
  }
  
  // Final status check
  try {
    const finalResponse = await axios.get(
      `https://api.retellai.com/v2/get-call/${callId}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );
    
    const finalData = finalResponse.data;
    logInfo('\n📊 Final Call Status:');
    logInfo(`   Status: ${finalData.call_status}`);
    logInfo(`   Direction: ${finalData.direction}`);
    logInfo(`   Duration: ${finalData.duration_ms ? (finalData.duration_ms / 1000).toFixed(2) + 's' : '0s'}`);
    if (finalData.disconnection_reason) {
      logWarning(`   Disconnection Reason: ${finalData.disconnection_reason}`);
    }
    if (finalData.call_analysis) {
      logInfo(`   Call Successful: ${finalData.call_analysis.call_successful}`);
      logInfo(`   User Sentiment: ${finalData.call_analysis.user_sentiment || 'Unknown'}`);
    }
    if (finalData.call_cost) {
      logInfo(`   Cost: $${finalData.call_cost.combined_cost || '0.000'}`);
    }
 agent log
  } catch (error) {
    logError(`Failed to get final status: ${error.message}`);
  }
}

async function testWebhookEndpoints() {
  logSection('7. Webhook Endpoints Test');
  
  const apiBaseUrl = process.env.API_BASE_URL || 'https://api.callsomo.com';
  
  const endpoints = [
    { name: 'Voice Incoming', url: `${apiBaseUrl}/voice/incoming` },
    { name: 'SMS Incoming', url: `${apiBaseUrl}/sms/incoming` },
    // HTTP health for LLM path (WebSocket is wss:// same path — tested separately)
    { name: 'Retell LLM (HTTP health)', url: `${apiBaseUrl}/webhook/retell/llm` }
  ];
  
  for (const endpoint of endpoints) {
    try {
      logInfo(`Testing ${endpoint.name}: ${endpoint.url}`);
      
      if (endpoint.url.includes('ws://') || endpoint.url.includes('wss://')) {
        logWarning('WebSocket endpoints cannot be tested via HTTP');
        continue;
      }
      
      // Just check if endpoint exists (HEAD request)
      const response = await axios.head(endpoint.url, {
        timeout: 5000,
        validateStatus: (status) => status < 500 // Accept 404, 405, etc. as "endpoint exists"
      });
      
      if (response.status === 200 || response.status === 405) {
        logSuccess(`${endpoint.name} is accessible (status: ${response.status})`);
      } else {
        logWarning(`${endpoint.name} returned status: ${response.status}`);
      }
    } catch (error) {
      if (error.response) {
        if (error.response.status === 404) {
          logError(`${endpoint.name} not found (404)`);
        } else if (error.response.status === 405) {
          logWarning(`${endpoint.name} exists but method not allowed (405) - this is OK for POST-only endpoints`);
        } else {
          logError(`${endpoint.name} error: ${error.response.status}`);
        }
      } else {
        logError(`${endpoint.name} error: ${error.message}`);
      }
    }
  }
}

async function testTwilioDirectCall() {
  logSection('8. Twilio Direct Call Test (Fallback Method)');
  
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    const apiBaseUrl = process.env.API_BASE_URL || 'https://api.callsomo.com';
    
    if (!accountSid || !authToken || !fromNumber) {
      logWarning('Twilio credentials not configured, skipping direct call test');
      return;
    }
    
    logInfo('Testing Twilio direct call (bypassing Retell telephony)...');
    logInfo(`From: ${fromNumber}`);
    logInfo(`To: ${TARGET_PHONE}`);
    
    const webhookUrl = new URL(`${apiBaseUrl}/voice/incoming`);
    webhookUrl.searchParams.set('call_type', 'sales_outbound');
    webhookUrl.searchParams.set('test_mode', 'diagnostic');
    
    logInfo(`Webhook URL: ${webhookUrl.toString()}`);
    
    const client = twilio(accountSid, authToken);
    
    const call = await client.calls.create({
      from: fromNumber,
      to: TARGET_PHONE,
      url: webhookUrl.toString(),
      statusCallback: `${apiBaseUrl}/voice/status-callback`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
    });
    
    logSuccess('Twilio call created!');
    logInfo(`Call SID: ${call.sid}`);
    logInfo(`Status: ${call.status}`);
    logInfo(`Direction: ${call.direction}`);
 agent log
    
    return call.sid;
  } catch (error) {
    logError(`Twilio direct call failed: ${error.message}`);
    if (error.code) {
      logError(`Twilio Error Code: ${error.code}`);
    }
    if (error.moreInfo) {
      logError(`More Info: ${error.moreInfo}`);
    }
    return null;
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  log('🔍 OUTBOUND CALL DIAGNOSTIC TOOL', 'cyan');
  console.log('='.repeat(60));
  log(`Target Phone: ${TARGET_PHONE}`, 'blue');
  console.log('='.repeat(60) + '\n');
  
  const results = {
    envVars: false,
    retellAPI: false,
    twilioConfig: false,
    agentConfig: false,
    callCreated: false,
    webhooks: false
  };
  
  // Run all tests
  results.envVars = await testEnvironmentVariables();
  
  if (!results.envVars) {
    logError('\n❌ Critical environment variables missing. Some tests may fail.');
    logWarning('Continuing with available configuration...\n');
  }
  
  results.retellAPI = await testRetellAPI();
  results.twilioConfig = await testTwilioConfiguration();
  results.agentConfig = await testRetellAgentConfiguration();
  results.webhooks = await testWebhookEndpoints();
  
  // Test outbound call creation
  const callId = await testOutboundCallCreation();
  results.callCreated = !!callId;
  
  if (callId) {
    // Monitor call status
    await monitorCallStatus(callId, 15000); // Monitor for 15 seconds
  }
  
  // Test Twilio direct as fallback
  await testTwilioDirectCall();
  
  // Summary
  logSection('📋 Diagnostic Summary');
  
  logInfo('Test Results:');
  log(`${results.envVars ? '✅' : '❌'} Environment Variables`, results.envVars ? 'green' : 'red');
  log(`${results.retellAPI ? '✅' : '❌'} Retell API`, results.retellAPI ? 'green' : 'red');
  log(`${results.twilioConfig ? '✅' : '❌'} Twilio Configuration`, results.twilioConfig ? 'green' : 'red');
  log(`${results.agentConfig ? '✅' : '❌'} Agent Configuration`, results.agentConfig ? 'green' : 'red');
  log(`${results.callCreated ? '✅' : '❌'} Call Creation`, results.callCreated ? 'green' : 'red');
  log(`${results.webhooks ? '✅' : '❌'} Webhook Endpoints`, results.webhooks ? 'green' : 'red');
  
  console.log('\n' + '='.repeat(60));
  log('✅ Diagnostic complete!', 'cyan');
  console.log('='.repeat(60) + '\n');
  
  if (callId) {
    logInfo(`Call ID for reference: ${callId}`);
    logInfo('Check Retell dashboard and Twilio console for detailed logs');
  }
}

main().catch(error => {
  logError(`\n❌ Fatal error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

