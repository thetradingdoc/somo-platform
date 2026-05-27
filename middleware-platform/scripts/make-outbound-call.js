#!/usr/bin/env node

/**
 * Make an outbound call via Retell
 * Usage: node scripts/make-outbound-call.js <phone_number>
 * Example: node scripts/make-outbound-call.js 8622307479
 */

require('dotenv').config();
const twilio = require('twilio');

const phoneNumber = process.argv[2];

if (!phoneNumber) {
    console.error('❌ Error: Phone number required');
    console.log('Usage: node scripts/make-outbound-call.js <phone_number>');
    console.log('Example: node scripts/make-outbound-call.js 8622307479');
    process.exit(1);
}

// Format phone number (add +1 if US number)
function formatPhoneNumber(num) {
    let cleaned = num.replace(/\D/g, '');
    if (cleaned.length === 10) {
        return `+1${cleaned}`;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return `+${cleaned}`;
    } else if (num.startsWith('+')) {
        return num;
    } else {
        return `+${cleaned}`;
    }
}

async function makeCall() {
    try {
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        // Get configuration
        const agentId = process.env.RETELL_AGENT_ID || process.env.RETELL_SALES_AGENT_ID;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;
        const toNumber = formatPhoneNumber(phoneNumber);
        const apiBase = process.env.API_BASE_URL || process.env.BASE_URL;
        
        if (!agentId) {
            throw new Error('RETELL_AGENT_ID or RETELL_SALES_AGENT_ID not configured');
        }
        
        if (!fromNumber) {
            throw new Error('TWILIO_PHONE_NUMBER not configured');
        }
        if (!apiBase) {
            throw new Error('API_BASE_URL or BASE_URL not configured');
        }
        
        console.log('📞 Making outbound call...');
        console.log(`   From: ${fromNumber}`);
        console.log(`   To: ${toNumber}`);
        console.log(`   Agent: ${agentId}`);
        console.log('');
        
        const webhookUrl = new URL(`${String(apiBase).replace(/\/+$/, '')}/voice/incoming`);
        webhookUrl.searchParams.set('call_type', 'sales_outbound');
        webhookUrl.searchParams.set('agent_id', agentId);
        webhookUrl.searchParams.set('test_mode', 'manual_script');

        // Twilio-direct primary path (works with current production telephony settings).
        const twilioCall = await twilioClient.calls.create({
            from: fromNumber,
            to: toNumber,
            url: webhookUrl.toString(),
            statusCallback: `${String(apiBase).replace(/\/+$/, '')}/voice/status-callback`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
        });
        
        console.log('');
        console.log('✅ Call initiated successfully!');
        console.log(`   Call SID: ${twilioCall.sid}`);
        console.log(`   Status: ${twilioCall.status || 'queued'}`);
        console.log(`   Provider: twilio_direct`);
        
    } catch (error) {
        console.error('');
        console.error('❌ Failed to make call:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Response:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

makeCall();

