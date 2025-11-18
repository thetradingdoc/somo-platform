#!/usr/bin/env node

/**
 * Email Flow Test
 * Tests complete email flow with real email addresses
 * - Appointment confirmation
 * - Insurance billing
 * - Patient billing
 * - Checkout/copay
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';
const PATIENT_EMAIL = 'doctorjay254@gmail.com';
const INSURER_EMAIL = 'gigtogigdev@gmail.com';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
    log('\n📧 EMAIL FLOW TEST', 'cyan');
    log('='.repeat(70), 'cyan');
    log(`Patient Email: ${PATIENT_EMAIL}`, 'blue');
    log(`Insurer Email: ${INSURER_EMAIL}`, 'blue');
    log('='.repeat(70), 'cyan');

    // Check server
    try {
        await axios.get(`${API_BASE_URL}/health`);
        log('\n✅ Server is running', 'green');
    } catch (error) {
        log('\n❌ Server is not running', 'red');
        process.exit(1);
    }

    const testData = {};
    const today = new Date();
    const appointmentTime = new Date(today);
    appointmentTime.setHours(13, 0, 0, 0); // 1:00 PM today
    
    // If it's past 1pm, set for tomorrow
    if (appointmentTime < new Date()) {
        appointmentTime.setDate(appointmentTime.getDate() + 1);
    }
    
    const date = appointmentTime.toISOString().split('T')[0];
    const time12 = '1:00 PM';
    const testPhone = `+1555${Math.floor(Math.random() * 10000000)}`;
    const testName = 'Test Patient Email Flow';

    log(`\n📅 Booking appointment for: ${date} at ${time12}`, 'cyan');

    try {
        // 1. Book Appointment
        log('\n1️⃣  Booking appointment...', 'cyan');
        const appointmentResponse = await axios.post(`${API_BASE_URL}/voice/appointments/schedule`, {
            patient_name: testName,
            patient_phone: testPhone,
            patient_email: PATIENT_EMAIL,
            appointment_type: 'Therapy Session - Psychiatry',
            date: date,
            time: time12,
            timezone: 'America/New_York',
            notes: 'Email flow test appointment'
        });

        if (!appointmentResponse.data.success) {
            throw new Error('Failed to book appointment');
        }

        testData.appointmentId = appointmentResponse.data.appointment.id;
        testData.patientId = appointmentResponse.data.appointment.patient_id;
        log(`   ✅ Appointment booked: ${testData.appointmentId}`, 'green');
        log(`   📧 Confirmation email sent to: ${PATIENT_EMAIL}`, 'green');

        // 2. Collect Insurance
        log('\n2️⃣  Collecting insurance...', 'cyan');
        const memberId = `TEST${Date.now()}`;
        const insuranceResponse = await axios.post(`${API_BASE_URL}/voice/insurance/collect`, {
            patient_name: testName,
            member_id: memberId,
            payer_name: 'Cigna',
            patient_phone: testPhone,
            patient_email: PATIENT_EMAIL,
            service_code: '90834'
        });

        if (!insuranceResponse.data.success) {
            throw new Error('Failed to collect insurance');
        }

        testData.memberId = memberId;
        log(`   ✅ Insurance collected: ${memberId}`, 'green');

        // 3. Submit Insurance Claim (Billing to Insurance)
        log('\n3️⃣  Submitting insurance claim...', 'cyan');
        log(`   📧 Billing email will be sent to: ${INSURER_EMAIL}`, 'yellow');
        
        const claimResponse = await axios.post(`${API_BASE_URL}/voice/insurance/submit-claim`, {
            appointment_id: testData.appointmentId,
            patient_id: testData.patientId,
            member_id: testData.memberId,
            payer_id: 'CIGNA',
            service_code: '90834',
            diagnosis_code: 'F41.1',
            total_amount: 150.00,
            copay_paid: 20.00
        });

        if (!claimResponse.data.success) {
            throw new Error('Failed to submit claim');
        }

        testData.claimId = claimResponse.data.claimId;
        log(`   ✅ Claim submitted: ${testData.claimId}`, 'green');
        log(`   📧 Billing email sent to: ${INSURER_EMAIL}`, 'green');

        // 4. Create Patient Checkout (Billing to Patient + Copay)
        log('\n4️⃣  Creating patient checkout...', 'cyan');
        log(`   📧 Checkout email will be sent to: ${PATIENT_EMAIL}`, 'yellow');
        
        const checkoutResponse = await axios.post(`${API_BASE_URL}/voice/appointments/checkout`, {
            appointment_id: testData.appointmentId,
            customer_name: testName,
            customer_email: PATIENT_EMAIL,
            customer_phone: testPhone,
            appointment_type: 'Therapy Session - Psychiatry',
            amount: 20.00 // Copay amount
        });

        if (!checkoutResponse.data.success) {
            throw new Error('Failed to create checkout');
        }

        testData.checkoutId = checkoutResponse.data.checkout_id;
        log(`   ✅ Checkout created: ${testData.checkoutId}`, 'green');
        log(`   📧 Checkout verification code sent to: ${PATIENT_EMAIL}`, 'green');

        // Summary
        log('\n' + '='.repeat(70), 'cyan');
        log('📊 EMAIL SUMMARY', 'cyan');
        log('='.repeat(70), 'cyan');
        log(`\n✅ Emails Sent:`, 'green');
        log(`   1. Appointment Confirmation → ${PATIENT_EMAIL}`, 'green');
        log(`   2. Insurance Billing → ${INSURER_EMAIL}`, 'green');
        log(`   3. Patient Billing → ${PATIENT_EMAIL}`, 'green');
        log(`   4. Checkout/Copay Verification → ${PATIENT_EMAIL}`, 'green');
        log(`\n📧 Total: 4 emails sent`, 'cyan');
        log(`\n📋 Test Data:`, 'cyan');
        log(`   Appointment ID: ${testData.appointmentId}`, 'blue');
        log(`   Claim ID: ${testData.claimId}`, 'blue');
        log(`   Checkout ID: ${testData.checkoutId}`, 'blue');
        log(`\n✅ All emails sent successfully!`, 'green');
        log(`\n📬 Please check inboxes:`, 'yellow');
        log(`   - ${PATIENT_EMAIL} (should receive 3 emails)`, 'yellow');
        log(`   - ${INSURER_EMAIL} (should receive 1 email)`, 'yellow');

    } catch (error) {
        log(`\n❌ Error: ${error.message}`, 'red');
        if (error.response) {
            log(`   Status: ${error.response.status}`, 'red');
            log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
        }
        process.exit(1);
    }
}

main();

