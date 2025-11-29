#!/usr/bin/env node
/**
 * Check Twilio Call Details and Webhook Status
 * 
 * Usage:
 *   node scripts/check-call-details.js CA09f41d841d3b4e499b9433aa2b3ecf67
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false
});

const twilio = require('twilio');
const axios = require('axios');

const CALL_SID = process.argv[2] || 'CA09f41d841d3b4e499b9433aa2b3ecf67';
const apiBaseUrl = process.env.API_BASE_URL || 'https://api.doclittle.site';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 CALL DETAILS CHECK');
  console.log('='.repeat(70));
  console.log(`Call SID: ${CALL_SID}\n`);

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.error('❌ Missing Twilio configuration');
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);

  try {
    // Fetch call details
    console.log('📞 Fetching Twilio call details...');
    const call = await client.calls(CALL_SID).fetch();
    
    console.log('\n✅ Call Details:');
    console.log(`   Status: ${call.status}`);
    console.log(`   Direction: ${call.direction}`);
    console.log(`   From: ${call.from}`);
    console.log(`   To: ${call.to}`);
    console.log(`   Duration: ${call.duration || '0'}s`);
    console.log(`   Start Time: ${call.startTime}`);
    console.log(`   End Time: ${call.endTime || 'N/A'}`);
    
    if (call.status === 'failed' || call.status === 'busy') {
      console.log(`\n⚠️  Call Status: ${call.status}`);
      
      // Get error details
      try {
        const notifications = await client.calls(CALL_SID).notifications.list({ limit: 5 });
        if (notifications.length > 0) {
          console.log('\n📋 Error Notifications:');
          notifications.forEach((n, i) => {
            console.log(`\n   ${i + 1}. Code ${n.errorCode}: ${n.message || 'N/A'}`);
            console.log(`      Log Level: ${n.log || 'N/A'}`);
            console.log(`      More Info: ${n.moreInfo || 'N/A'}`);
          });
        }
      } catch (err) {
        console.log(`\n⚠️  Could not fetch notifications: ${err.message}`);
      }

      // Get events
      try {
        const events = await client.calls(CALL_SID).events.list({ limit: 10 });
        if (events.length > 0) {
          console.log('\n📋 Call Events:');
          events.forEach((e, i) => {
            console.log(`   ${i + 1}. ${e.timestamp}: ${e.type} - ${e.description || 'N/A'}`);
          });
        }
      } catch (err) {
        console.log(`\n⚠️  Could not fetch events: ${err.message}`);
      }
    }

    // Check webhook URL
    console.log('\n' + '='.repeat(70));
    console.log('🌐 WEBHOOK CHECK');
    console.log('='.repeat(70));
    
    const webhookUrl = `${apiBaseUrl}/voice/incoming`;
    console.log(`\nTesting: ${webhookUrl}`);
    
    try {
      const response = await axios.get(webhookUrl, {
        timeout: 5000,
        validateStatus: () => true // Don't throw on any status
      });
      console.log(`✅ Webhook is accessible (Status: ${response.status})`);
    } catch (err) {
      console.log(`❌ Webhook check failed: ${err.message}`);
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        console.log('   → Server might not be running or not accessible');
      }
    }

    // Check status callback URL
    const statusCallbackUrl = `${apiBaseUrl}/voice/status-callback`;
    console.log(`\nTesting: ${statusCallbackUrl}`);
    
    try {
      const response = await axios.get(statusCallbackUrl, {
        timeout: 5000,
        validateStatus: () => true
      });
      console.log(`✅ Status callback is accessible (Status: ${response.status})`);
    } catch (err) {
      console.log(`❌ Status callback check failed: ${err.message}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('💡 DIAGNOSIS');
    console.log('='.repeat(70));
    
    if (call.status === 'busy' && call.duration === '0') {
      console.log('\n⚠️  Call failed immediately with "busy" status');
      console.log('   This usually means:');
      console.log('   1. Twilio cannot route the call to the destination');
      console.log('   2. The SIP trunk is not configured correctly in Retell');
      console.log('   3. The destination number is unreachable');
      console.log('\n   Next steps:');
      console.log('   - Verify Retell SIP trunk configuration:');
      console.log('     * Termination URI: aimedicalvoiceagent.pstn.twilio.com');
      console.log('     * SIP Username: doclittles');
      console.log('     * SIP Password: (from Twilio credential list)');
      console.log('   - Check if the webhook was called (check server logs)');
      console.log('   - Try using Retell\'s outbound API instead of Twilio direct');
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.code) {
      console.error(`   Twilio Error Code: ${error.code}`);
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

