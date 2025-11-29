#!/usr/bin/env node
/**
 * Direct Call Script - Call a specific phone number
 * 
 * Usage:
 *   node scripts/call-number.js +18622307479
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false
});

const twilio = require('twilio');
const db = require('../database');
const { v4: uuidv4 } = require('uuid');

const TARGET_PHONE = process.argv[2];

if (!TARGET_PHONE) {
  console.error('Usage: node scripts/call-number.js +18622307479');
  process.exit(1);
}

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

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

async function main() {
  logSection('📞 DIRECT CALL TEST');
  log(`Target: ${TARGET_PHONE}`, 'blue');
  console.log('='.repeat(70) + '\n');

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const apiBaseUrl = process.env.API_BASE_URL || 'https://api.doclittle.site';

  if (!accountSid || !authToken || !fromNumber) {
    logError('Missing Twilio configuration');
    process.exit(1);
  }

  // Create test lead
  const leadId = uuidv4();
  const leadData = {
    id: leadId,
    title: 'Medical Receptionist',
    clinic_name: 'Test Clinic - Direct Call',
    clinic_phone: TARGET_PHONE,
    clinic_email: 'test@example.com',
    location: 'Test Location',
    status: 'new',
    pipeline_stage: 'new',
    is_qualified: 1,
    source: 'direct_call_test'
  };

  db.createLead(leadData);
  logSuccess(`Lead created: ${leadId}`);

  // Create call record
  const callId = `call_${Date.now()}_${uuidv4().substring(0, 8)}`;
  const callRecord = db.createLeadCall({
    lead_id: leadId,
    call_id: callId,
    call_status: 'initiated',
    notes: `Direct call to ${TARGET_PHONE}`
  });
  const callRecordId = callRecord.lastInsertRowid || callRecord.id;
  logSuccess(`Call record created: ${callId}`);

  // Build webhook URL
  const webhookUrl = new URL(`${apiBaseUrl}/voice/incoming`);
  webhookUrl.searchParams.set('lead_id', leadId);
  webhookUrl.searchParams.set('clinic_name', encodeURIComponent(leadData.clinic_name));
  webhookUrl.searchParams.set('call_type', 'sales_outbound');
  webhookUrl.searchParams.set('call_id', callId);

  logInfo(`Webhook URL: ${webhookUrl.toString()}`);

  // Create Twilio call
  const client = twilio(accountSid, authToken);

  logInfo('Initiating Twilio call...');

  try {
    const call = await client.calls.create({
      from: fromNumber,
      to: TARGET_PHONE,
      url: webhookUrl.toString(),
      method: 'POST',
      statusCallback: `${apiBaseUrl}/voice/status-callback`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      timeout: 30
    });

    logSuccess('Twilio call created!');
    logInfo(`Call SID: ${call.sid}`);
    logInfo(`Status: ${call.status}`);

    // Update call record
    db.updateLeadCall(callRecordId, {
      call_id: call.sid
    });

    // Monitor call status
    logInfo('\nMonitoring call status...');

    for (let i = 0; i < 15; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        const updatedCall = await client.calls(call.sid).fetch();
        const elapsed = (i + 1) * 2;

        if (updatedCall.status !== call.status) {
          logInfo(`[${elapsed}s] Status: ${call.status} → ${updatedCall.status}`);
          call.status = updatedCall.status;

          if (updatedCall.duration) {
            logInfo(`   Duration: ${updatedCall.duration}s`);
          }

          if (updatedCall.status === 'in-progress' || updatedCall.status === 'completed') {
            logSuccess('Call connected!');
            break;
          }

          if (updatedCall.status === 'failed' || updatedCall.status === 'busy' || updatedCall.status === 'no-answer') {
            logError(`Call ended: ${updatedCall.status}`);

            // Get error details
            try {
              const notifications = await client.calls(call.sid).notifications.list({ limit: 3 });
              if (notifications.length > 0) {
                logInfo('Errors:');
                notifications.forEach(n => {
                  logInfo(`  - Code ${n.errorCode}: ${n.message || 'N/A'}`);
                });
              }
            } catch (err) {
              // Ignore
            }

            break;
          }
        }
      } catch (error) {
        logError(`Error checking status: ${error.message}`);
        break;
      }
    }

    // Final status
    try {
      const finalCall = await client.calls(call.sid).fetch();

      console.log('\n' + '='.repeat(70));
      log('📊 FINAL CALL STATUS', 'cyan');
      console.log('='.repeat(70));
      logInfo(`Call SID: ${finalCall.sid}`);
      logInfo(`Status: ${finalCall.status}`);
      logInfo(`Direction: ${finalCall.direction}`);
      logInfo(`Duration: ${finalCall.duration || '0'}s`);

      // Update database
      db.updateLeadCall(callRecordId, {
        call_status: finalCall.status,
        call_duration_seconds: finalCall.duration || 0
      });

      if (finalCall.status === 'completed' || finalCall.status === 'in-progress') {
        logSuccess('\n✅ Call connected successfully!');
        logInfo('Check server logs to see if webhook was called');
        logInfo('Look for: "📞 INCOMING CALL from Twilio"');
      } else {
        logWarning(`\n⚠️  Call status: ${finalCall.status}`);
        logInfo('Check server logs and Twilio console for details');
      }

    } catch (error) {
      logError(`Failed to get final status: ${error.message}`);
    }

  } catch (error) {
    logError(`Failed to create Twilio call: ${error.message}`);
    if (error.code) {
      logError(`Twilio Error Code: ${error.code}`);
    }
    process.exit(1);
  }
}

main().catch(error => {
  logError(`\n❌ Fatal error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

