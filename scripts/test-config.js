#!/usr/bin/env node
/**
 * Test Production Configuration
 * Tests if Twilio and Retell are properly configured and working
 */

const { execSync } = require('child_process');
const axios = require('axios');

async function runTests() {
  console.log('🧪 Testing Production Configuration\n');
  console.log('═'.repeat(70));

  // Get production config
  console.log('📡 Fetching production config from Azure...');
  let config = {};
  try {
    const output = execSync(
      'az webapp config appsettings list --name doclittle --resource-group doclittle --output json',
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    const settings = JSON.parse(output);
    settings.forEach(setting => {
      config[setting.name] = setting.value;
    });
  } catch (error) {
    console.error('❌ Failed to get production config:', error.message);
    process.exit(1);
  }

  console.log('\n📋 CONFIGURATION CHECK');
  console.log('═'.repeat(70));

  // Check required variables
  const required = {
    'TWILIO_ACCOUNT_SID': config.TWILIO_ACCOUNT_SID,
    'TWILIO_AUTH_TOKEN': config.TWILIO_AUTH_TOKEN,
    'TWILIO_PHONE_NUMBER': config.TWILIO_PHONE_NUMBER,
    'RETELL_API_KEY': config.RETELL_API_KEY,
    'RETELL_AGENT_ID': config.RETELL_AGENT_ID,
    'API_BASE_URL': config.API_BASE_URL
  };

  let allPresent = true;
  Object.keys(required).forEach(key => {
    const value = required[key];
    const status = value ? '✅' : '❌';
    const display = value ? (key.includes('TOKEN') || key.includes('KEY') ?
      value.substring(0, 4) + '...' + value.substring(value.length - 4) : value) : '(not set)';
    console.log(`${status} ${key}: ${display}`);
    if (!value) allPresent = false;
  });

  if (!allPresent) {
    console.error('\n❌ Missing required configuration. Please set all variables.');
    process.exit(1);
  }

  // Test 1: Twilio API
  console.log('\n\n📞 TEST 1: Twilio API Connection');
  console.log('═'.repeat(70));
  try {
    const twilio = require('twilio');
    const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

    // Get phone number info
    const phoneNumbers = await client.incomingPhoneNumbers.list({ phoneNumber: config.TWILIO_PHONE_NUMBER });

    if (phoneNumbers.length > 0) {
      const phoneNumber = phoneNumbers[0];
      console.log('✅ Twilio connection successful');
      console.log(`   Phone Number: ${phoneNumber.phoneNumber}`);
      console.log(`   Friendly Name: ${phoneNumber.friendlyName || 'N/A'}`);
      console.log(`   Status: Active`);

      // Check webhook
      if (phoneNumber.voiceUrl) {
        console.log(`   Voice Webhook: ${phoneNumber.voiceUrl}`);
        const expectedWebhook = `${config.API_BASE_URL}/voice/incoming`;
        if (phoneNumber.voiceUrl === expectedWebhook) {
          console.log('   ✅ Webhook URL matches production');
        } else {
          console.log(`   ⚠️  Webhook URL mismatch!`);
          console.log(`      Expected: ${expectedWebhook}`);
          console.log(`      Current:  ${phoneNumber.voiceUrl}`);
        }
      } else {
        console.log('   ⚠️  No voice webhook configured');
      }
    } else {
      console.log('⚠️  Phone number not found in Twilio account');
    }
  } catch (error) {
    console.error('❌ Twilio test failed:', error.message);
    if (error.code === 20003) {
      console.error('   Invalid credentials. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    }
  }

  // Test 2: Retell API
  console.log('\n\n🤖 TEST 2: Retell API Connection');
  console.log('═'.repeat(70));
  try {
    const response = await axios.get(
      `https://api.retellai.com/v2/agent/${config.RETELL_AGENT_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${config.RETELL_API_KEY}`
        }
      }
    );

    const agent = response.data;
    console.log('✅ Retell connection successful');
    console.log(`   Agent ID: ${agent.agent_id}`);
    console.log(`   Agent Name: ${agent.agent_name || 'N/A'}`);
    console.log(`   Status: ${agent.status || 'N/A'}`);

    // Check webhook
    if (agent.llm_websocket_url) {
      console.log(`   LLM WebSocket: ${agent.llm_websocket_url}`);
      const expectedWebhook = `wss://${config.API_BASE_URL.replace('https://', '').replace('http://', '')}/webhook/retell/llm`;
      if (agent.llm_websocket_url.includes(config.API_BASE_URL.replace('https://', '').replace('http://', ''))) {
        console.log('   ✅ Webhook URL matches production');
      } else {
        console.log(`   ⚠️  Webhook URL may need update`);
        console.log(`      Expected: ${expectedWebhook}`);
        console.log(`      Current:  ${agent.llm_websocket_url}`);
      }
    } else {
      console.log('   ⚠️  No LLM WebSocket URL configured');
    }
  } catch (error) {
    console.error('❌ Retell test failed:', error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error: ${JSON.stringify(error.response.data)}`);
    }
  }

  // Test 3: Production API Health
  console.log('\n\n🌐 TEST 3: Production API Health');
  console.log('═'.repeat(70));
  try {
    const healthUrl = `${config.API_BASE_URL}/health`;
    console.log(`   Testing: ${healthUrl}`);
    const response = await axios.get(healthUrl, { timeout: 5000 });
    console.log('✅ Production API is responding');
    console.log(`   Status: ${response.status}`);
    if (response.data) {
      console.log(`   Response: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.error('❌ Production API test failed:', error.message);
    if (error.code === 'ENOTFOUND') {
      console.error('   DNS not resolving. Check domain configuration.');
    }
  }

  // Summary
  console.log('\n\n📊 TEST SUMMARY');
  console.log('═'.repeat(70));
  console.log('✅ Configuration check complete');
  console.log('\n💡 Next steps:');
  console.log('   1. Verify Twilio webhook points to: ' + config.API_BASE_URL + '/voice/incoming');
  console.log('   2. Verify Retell webhook points to: wss://' + config.API_BASE_URL.replace('https://', '').replace('http://', '') + '/webhook/retell/llm');
  console.log('   3. Make a test call to verify end-to-end functionality');

  console.log('\n');
}

// Run tests
runTests().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

