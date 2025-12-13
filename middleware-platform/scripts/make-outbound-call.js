#!/usr/bin/env node

/**
 * Make an outbound call via Retell
 * Usage: node scripts/make-outbound-call.js <phone_number>
 * Example: node scripts/make-outbound-call.js 8622307479
 */

require('dotenv').config();
const RetellService = require('../services/retell-service');

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
        const retellService = new RetellService();
        
        // Get configuration
        const agentId = process.env.RETELL_AGENT_ID || process.env.RETELL_SALES_AGENT_ID;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;
        const toNumber = formatPhoneNumber(phoneNumber);
        
        if (!agentId) {
            throw new Error('RETELL_AGENT_ID or RETELL_SALES_AGENT_ID not configured');
        }
        
        if (!fromNumber) {
            throw new Error('TWILIO_PHONE_NUMBER not configured');
        }
        
        console.log('📞 Making outbound call...');
        console.log(`   From: ${fromNumber}`);
        console.log(`   To: ${toNumber}`);
        console.log(`   Agent: ${agentId}`);
        console.log('');
        
        const result = await retellService.createOutboundCall(
            agentId,
            fromNumber,
            toNumber,
            {
                override_agent_id: agentId,
                retell_llm_dynamic_variables: {
                    call_type: 'outbound_test'
                },
                metadata: {
                    call_type: 'outbound_test',
                    initiated_by: 'manual_script'
                }
            }
        );
        
        console.log('');
        console.log('✅ Call initiated successfully!');
        console.log(`   Call ID: ${result.call_id}`);
        console.log(`   Status: ${result.call_data?.call_status || 'initiated'}`);
        
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

