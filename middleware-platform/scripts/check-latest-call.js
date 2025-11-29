#!/usr/bin/env node
/**
 * Check Latest Twilio Call Details
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false
});

const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

async function checkLatestCall() {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 CHECKING LATEST CALL');
  console.log('='.repeat(70) + '\n');

  if (!accountSid || !authToken) {
    console.error('❌ Missing Twilio credentials');
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);

  try {
    // Get the most recent call
    const calls = await client.calls.list({ limit: 1 });
    
    if (calls.length === 0) {
      console.log('⚠️  No calls found');
      return;
    }

    const call = calls[0];
    
    console.log('📞 Latest Call Details:');
    console.log(`   Call SID: ${call.sid}`);
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
        const notifications = await client.calls(call.sid).notifications.list({ limit: 5 });
        if (notifications.length > 0) {
          console.log('\n📋 Error Notifications:');
          notifications.forEach((n, i) => {
            console.log(`\n   ${i + 1}. Code ${n.errorCode}: ${n.message || 'N/A'}`);
            console.log(`      Log Level: ${n.log || 'N/A'}`);
            if (n.moreInfo) {
              console.log(`      More Info: ${n.moreInfo}`);
            }
          });
        }
      } catch (err) {
        console.log(`\n⚠️  Could not fetch notifications: ${err.message}`);
      }
    }

    // Check if it's a trunking call
    if (call.direction === 'trunking-terminating') {
      console.log('\n' + '='.repeat(70));
      console.log('💡 DIAGNOSIS: Trunking Terminating Call');
      console.log('='.repeat(70));
      
      if (call.status === 'failed') {
        console.log('\n❌ Call failed - likely SIP authentication issue');
        console.log('\n📋 Check:');
        console.log('   1. Retell Dashboard → SIP Trunk Configuration');
        console.log('      - Termination URI: aimedicalvoiceagent.pstn.twilio.com');
        console.log('      - SIP Username: doclittles (must match Twilio exactly)');
        console.log('      - SIP Password: (must match Twilio exactly)');
        console.log('\n   2. Twilio Console → Call Logs → This Call → SIP PCAP Log');
        console.log('      - Look for "401 Unauthorized" or "403 Forbidden"');
        console.log('      - Check SIP authentication headers');
        console.log('\n   3. Verify credentials match:');
        console.log('      - Go to Twilio → SIP → Credential Lists → Retell-Auth');
        console.log('      - Check username is exactly: doclittles');
        console.log('      - Copy password and paste into Retell (no extra spaces)');
      }
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.code) {
      console.error(`   Twilio Error Code: ${error.code}`);
    }
    process.exit(1);
  }
}

checkLatestCall().catch(error => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

