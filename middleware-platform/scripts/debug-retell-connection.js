#!/usr/bin/env node
/**
 * Debug Retell Connection Issues
 * 
 * This script checks:
 * 1. If webhook is being called
 * 2. Retell agent configuration
 * 3. Retell SIP endpoint
 * 4. Recent Retell calls
 * 
 * Usage:
 *   node scripts/debug-retell-connection.js [call_sid]
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false
});

const axios = require('axios');
const retellService = require('../services/retell-service');

// Colors
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
  console.log('\n' + '='.repeat(70));
  log(title, 'cyan');
  console.log('='.repeat(70));
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

async function checkRetellAgent() {
  logSection('1. Checking Retell Agent Configuration');
  
  const agentId = process.env.RETELL_SALES_AGENT_ID || process.env.RETELL_AGENT_ID;
  
  if (!agentId) {
    logError('RETELL_SALES_AGENT_ID or RETELL_AGENT_ID not configured');
    return null;
  }
  
  logInfo(`Agent ID: ${agentId}`);
  
  try {
    const agent = await retellService.getAgent(agentId);
    
    if (agent) {
      logSuccess('Agent found!');
      logInfo(`Agent Name: ${agent.agent_name || 'N/A'}`);
      logInfo(`Agent Version: ${agent.agent_version || 'N/A'}`);
      logInfo(`Status: ${agent.status || 'N/A'}`);
      
      if (agent.telephony) {
        logInfo(`Telephony Provider: ${agent.telephony.provider || 'N/A'}`);
        logInfo(`Phone Number: ${agent.telephony.phone_number || 'N/A'}`);
      }
      
      return agent;
    } else {
      logError('Agent not found');
      return null;
    }
  } catch (error) {
    logError(`Failed to get agent: ${error.message}`);
    if (error.response) {
      logError(`Status: ${error.response.status}`);
      logError(`Data: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

async function checkRecentRetellCalls() {
  logSection('2. Checking Recent Retell Calls');
  
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    logError('RETELL_API_KEY not configured');
    return;
  }
  
  try {
    const response = await axios.get('https://api.retellai.com/v2/list-calls', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      params: {
        limit: 10
      }
    });
    
    if (response.data && response.data.calls) {
      const calls = response.data.calls;
      logInfo(`Found ${calls.length} recent calls`);
      
      if (calls.length > 0) {
        console.log('\nRecent Calls:');
        calls.slice(0, 5).forEach((call, index) => {
          console.log(`\n${index + 1}. Call ID: ${call.call_id}`);
          logInfo(`   Status: ${call.call_status || 'N/A'}`);
          logInfo(`   Direction: ${call.direction || 'N/A'}`);
          logInfo(`   From: ${call.from_number || 'N/A'}`);
          logInfo(`   To: ${call.to_number || 'N/A'}`);
          logInfo(`   Duration: ${call.duration_ms ? (call.duration_ms / 1000) + 's' : '0s'}`);
          
          if (call.disconnection_reason) {
            logWarning(`   Disconnection Reason: ${call.disconnection_reason}`);
          }
          
          if (call.call_analysis) {
            logInfo(`   Call Successful: ${call.call_analysis.call_successful || 'N/A'}`);
          }
        });
      } else {
        logWarning('No recent calls found');
      }
    }
  } catch (error) {
    logError(`Failed to get recent calls: ${error.message}`);
    if (error.response) {
      logError(`Status: ${error.response.status}`);
      logError(`Data: ${JSON.stringify(error.response.data)}`);
    }
  }
}

async function checkSpecificCall(callSid) {
  if (!callSid) return;
  
  logSection(`3. Checking Specific Call: ${callSid}`);
  
  // First, try to find this call in Retell by checking recent calls
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    logError('RETELL_API_KEY not configured');
    return;
  }
  
  try {
    // Get recent calls and look for one with matching metadata
    const response = await axios.get('https://api.retellai.com/v2/list-calls', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      params: {
        limit: 50
      }
    });
    
    if (response.data && response.data.calls) {
      const matchingCall = response.data.calls.find(call => 
        call.metadata && call.metadata.twilio_call_sid === callSid
      );
      
      if (matchingCall) {
        logSuccess('Found call in Retell!');
        logInfo(`Retell Call ID: ${matchingCall.call_id}`);
        logInfo(`Status: ${matchingCall.call_status}`);
        logInfo(`Direction: ${matchingCall.direction}`);
        logInfo(`Duration: ${matchingCall.duration_ms ? (matchingCall.duration_ms / 1000) + 's' : '0s'}`);
        
        if (matchingCall.disconnection_reason) {
          logWarning(`Disconnection Reason: ${matchingCall.disconnection_reason}`);
        }
        
        if (matchingCall.call_analysis) {
          logInfo(`Call Successful: ${matchingCall.call_analysis.call_successful || 'N/A'}`);
        }
        
        // Try to get detailed call info
        try {
          const detailResponse = await axios.get(
            `https://api.retellai.com/v2/get-call/${matchingCall.call_id}`,
            {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (detailResponse.data) {
            logInfo('\nDetailed Call Info:');
            console.log(JSON.stringify(detailResponse.data, null, 2));
          }
        } catch (detailError) {
          logWarning(`Could not get detailed call info: ${detailError.message}`);
        }
      } else {
        logWarning(`Call ${callSid} not found in Retell`);
        logInfo('This could mean:');
        logInfo('  1. The webhook was never called');
        logInfo('  2. The call registration failed');
        logInfo('  3. The call happened more than 50 calls ago');
      }
    }
  } catch (error) {
    logError(`Failed to check call: ${error.message}`);
  }
}

async function testWebhookDirectly() {
  logSection('4. Testing Webhook Directly (Simulating Twilio)');
  
  const apiBaseUrl = process.env.API_BASE_URL || 'https://api.doclittle.site';
  const webhookUrl = `${apiBaseUrl}/voice/incoming`;
  
  logInfo(`Webhook URL: ${webhookUrl}`);
  
  // Simulate Twilio POST
  const twilioPayload = {
    CallSid: `CA_TEST_${Date.now()}`,
    From: process.env.TWILIO_PHONE_NUMBER || '+15856202445',
    To: '+18622307479',
    CallStatus: 'ringing',
    Direction: 'outbound-api'
  };
  
  logInfo('Sending test webhook request...');
  
  try {
    const response = await axios.post(webhookUrl, twilioPayload, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000,
      validateStatus: (status) => status < 500
    });
    
    if (response.status === 200) {
      logSuccess('Webhook responded successfully!');
      logInfo(`Status: ${response.status}`);
      logInfo(`Content-Type: ${response.headers['content-type']}`);
      
      if (response.data && typeof response.data === 'string') {
        if (response.data.includes('<?xml')) {
          logSuccess('Response is TwiML (correct)');
          
          if (response.data.includes('sip:') && response.data.includes('livekit.cloud')) {
            logSuccess('Contains Retell SIP endpoint');
            
            // Extract SIP endpoint
            const sipMatch = response.data.match(/sip:([^@]+@[^<]+)/);
            if (sipMatch) {
              logInfo(`SIP Endpoint: ${sipMatch[1]}`);
            }
          } else {
            logError('Missing Retell SIP endpoint in response');
          }
        } else {
          logError('Response is not TwiML format');
        }
      }
    } else {
      logError(`Webhook returned status ${response.status}`);
    }
  } catch (error) {
    if (error.response) {
      logError(`Webhook error: ${error.response.status}`);
      logError(`Response: ${JSON.stringify(error.response.data)}`);
    } else {
      logError(`Webhook error: ${error.message}`);
    }
  }
}

async function checkSIPConfiguration() {
  logSection('5. Checking SIP Configuration');
  
  logInfo('SIP Endpoint Format: sip:{call_id}@5t4n6j0wnrl.sip.livekit.cloud');
  logInfo('This is Retell\'s SIP endpoint for WebSocket-based calls');
  
  const agentId = process.env.RETELL_SALES_AGENT_ID || process.env.RETELL_AGENT_ID;
  if (agentId) {
    logInfo(`Using Agent ID: ${agentId}`);
  }
  
  logInfo('\nKey Points:');
  logInfo('1. Twilio calls the webhook (/voice/incoming)');
  logInfo('2. Webhook registers call with Retell');
  logInfo('3. Retell returns SIP endpoint');
  logInfo('4. Webhook returns TwiML with SIP endpoint to Twilio');
  logInfo('5. Twilio connects to Retell via SIP');
  
  logWarning('\nIf calls show "busy" in Twilio:');
  logInfo('  - Check if webhook is being called (server logs)');
  logInfo('  - Check if Retell call registration succeeded');
  logInfo('  - Check if SIP endpoint is correct');
  logInfo('  - Check Retell dashboard for call status');
}

async function main() {
  const callSid = process.argv[2];
  
  console.log('\n' + '='.repeat(70));
  log('🔍 RETELL CONNECTION DEBUG', 'cyan');
  console.log('='.repeat(70));
  
  if (callSid) {
    log(`Checking call: ${callSid}`, 'blue');
  }
  console.log('='.repeat(70) + '\n');
  
  await checkRetellAgent();
  await checkRecentRetellCalls();
  
  if (callSid) {
    await checkSpecificCall(callSid);
  }
  
  await testWebhookDirectly();
  await checkSIPConfiguration();
  
  console.log('\n' + '='.repeat(70));
  log('📋 SUMMARY', 'cyan');
  console.log('='.repeat(70));
  logInfo('1. Check your server logs for webhook activity');
  logInfo('2. Check Retell dashboard → Call History');
  logInfo('3. Verify SIP endpoint in TwiML response');
  logInfo('4. Check if Retell agent is properly configured');
  console.log('='.repeat(70) + '\n');
}

main().catch(error => {
  logError(`\n❌ Fatal error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

