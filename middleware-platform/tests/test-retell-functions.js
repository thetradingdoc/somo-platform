#!/usr/bin/env node

/**
 * Test Retell Functions
 * Tests all Retell functions by simulating function calls
 * Run: node tests/test-retell-functions.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';
const MERCHANT_ID = process.env.MERCHANT_ID || 'd10794ff-ca11-4e6f-93e9-560162b4f884';
const TEST_CLINIC_ID = process.env.TEST_CLINIC_ID || 'test-clinic-retell';

const results = { passed: [], failed: [], warnings: [] };

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testFunction(name, testFn) {
    log(`\n${'='.repeat(80)}`, 'cyan');
    log(`Testing: ${name}`, 'cyan');
    log('='.repeat(80), 'cyan');

    try {
        const result = await testFn();
        if (result.success) {
            log(`✅ PASSED: ${name}`, 'green');
            results.passed.push(name);
            if (result.data) {
                console.log('   Response:', JSON.stringify(result.data, null, 2));
            }
            return result;
        } else {
            log(`❌ FAILED: ${name}`, 'red');
            log(`   Error: ${result.error}`, 'red');
            results.failed.push({ name, error: result.error });
            return result;
        }
    } catch (error) {
        log(`❌ FAILED: ${name}`, 'red');
        log(`   Error: ${error.message}`, 'red');
        if (error.response) {
            log(`   Status: ${error.response.status}`, 'red');
            log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
        }
        results.failed.push({ name, error: error.message });
        return { success: false, error: error.message };
    }
}

// Test 1: collect_insurance
async function testCollectInsurance() {
    return await testFunction('collect_insurance', async () => {
        const response = await axios.post(`${API_BASE_URL}/voice/insurance/collect`, {
            patient_name: 'John Doe',
            member_id: 'TEST123456',
            payer_name: 'Cigna',
            patient_phone: '+15551234567',
            patient_email: 'john.doe@example.com',
            service_code: '90834'
        });
        return { success: response.status === 200, data: response.data };
    });
}

// Test 2: get_available_slots
async function testGetAvailableSlots() {
    return await testFunction('get_available_slots', async () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const date = tomorrow.toISOString().split('T')[0];

        const response = await axios.post(`${API_BASE_URL}/voice/appointments/available-slots`, {
            date: date,
            appointment_type: 'Therapy Session - Psychiatry',
            timezone: 'America/New_York',
            clinic_id: TEST_CLINIC_ID
        });
        return { success: response.status === 200, data: response.data };
    });
}

// Test 3: schedule_appointment
let createdAppointmentId = null;
async function testScheduleAppointment() {
    return await testFunction('schedule_appointment', async () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const date = tomorrow.toISOString().split('T')[0];

        const response = await axios.post(`${API_BASE_URL}/voice/appointments/schedule`, {
            patient_name: 'John Doe',
            patient_phone: '+15551234567',
            patient_email: 'john.doe@example.com',
            appointment_type: 'Therapy Session - Psychiatry',
            date: date,
            time: '2:00 PM',
            timezone: 'America/New_York',
            notes: 'Test appointment from Retell function test',
            clinic_id: TEST_CLINIC_ID
        });

        if (response.data.success && response.data.appointment_id) {
            createdAppointmentId = response.data.appointment_id;
        }

        return { success: response.status === 200, data: response.data };
    });
}

// Test 4: search_appointments
async function testSearchAppointments() {
    return await testFunction('search_appointments', async () => {
        const response = await axios.post(`${API_BASE_URL}/voice/appointments/search`, {
            search_term: '+15551234567',
            clinic_id: TEST_CLINIC_ID
        });
        return { success: response.status === 200, data: response.data };
    });
}

// Test 5: confirm_appointment
async function testConfirmAppointment() {
    if (!createdAppointmentId) {
        return { success: false, error: 'No appointment ID from previous test' };
    }

    return await testFunction('confirm_appointment', async () => {
        const response = await axios.post(`${API_BASE_URL}/voice/appointments/confirm`, {
            appointment_id: createdAppointmentId,
            clinic_id: TEST_CLINIC_ID
        });
        return { success: response.status === 200, data: response.data };
    });
}

// Test 6: cancel_appointment
async function testCancelAppointment() {
    if (!createdAppointmentId) {
        return { success: false, error: 'No appointment ID from previous test' };
    }

    return await testFunction('cancel_appointment', async () => {
        const response = await axios.post(`${API_BASE_URL}/voice/appointments/cancel`, {
            appointment_id: createdAppointmentId,
            reason: 'Test cancellation',
            clinic_id: TEST_CLINIC_ID
        });
        return { success: response.status === 200, data: response.data };
    });
}

// Test 7: reschedule_appointment
async function testRescheduleAppointment() {
    if (!createdAppointmentId) {
        return { success: false, error: 'No appointment ID from previous test' };
    }

    return await testFunction('reschedule_appointment', async () => {
        const dayAfter = new Date();
        dayAfter.setDate(dayAfter.getDate() + 2);
        const newDate = dayAfter.toISOString().split('T')[0];

        const response = await axios.post(`${API_BASE_URL}/voice/appointments/reschedule`, {
            appointment_id: createdAppointmentId,
            new_date: newDate,
            new_time: '3:00 PM',
            timezone: 'America/New_York',
            reason: 'Test reschedule',
            clinic_id: TEST_CLINIC_ID
        });
        return { success: response.status === 200, data: response.data };
    });
}

// Test 8: create_appointment_checkout
let checkoutToken = null;
async function testCreateAppointmentCheckout() {
    if (!createdAppointmentId) {
        return { success: false, error: 'No appointment ID from previous test' };
    }

    return await testFunction('create_appointment_checkout', async () => {
        const response = await axios.post(`${API_BASE_URL}/voice/appointments/checkout`, {
            appointment_id: createdAppointmentId,
            customer_name: 'John Doe',
            customer_email: 'john.doe@example.com',
            customer_phone: '+15551234567',
            appointment_type: 'Therapy Session - Psychiatry',
            amount: 50.00
        });

        if (response.data.success && response.data.payment_token) {
            checkoutToken = response.data.payment_token;
        }

        return { success: response.status === 200, data: response.data };
    });
}

// Test 9: verify_checkout_code
async function testVerifyCheckoutCode() {
    if (!checkoutToken) {
        return { success: false, error: 'No checkout token from previous test' };
    }

    return await testFunction('verify_checkout_code', async () => {
        // Note: This will fail because we don't have the actual verification code
        // But we can test the endpoint exists
        const response = await axios.post(`${API_BASE_URL}/voice/checkout/verify`, {
            payment_token: checkoutToken,
            verification_code: '000000' // Dummy code
        });
        return { success: response.status === 200 || response.status === 400, data: response.data };
    });
}

// Test 10: get_patient_claims
async function testGetPatientClaims() {
    return await testFunction('get_patient_claims', async () => {
        // First collect insurance
        const insuranceResponse = await axios.post(`${API_BASE_URL}/voice/insurance/collect`, {
            patient_name: 'John Doe',
            member_id: 'TEST123456',
            payer_name: 'Cigna'
        });

        if (!insuranceResponse.data.success || !insuranceResponse.data.patient_id) {
            return { success: false, error: 'Could not collect insurance first' };
        }

        // Then get claims
        const response = await axios.get(`${API_BASE_URL}/api/patient/benefits`, {
            params: {
                patient_id: insuranceResponse.data.patient_id
            }
        });
        return { success: response.status === 200, data: response.data };
    });
}

// Main test runner
async function runAllTests() {
    log('\n🚀 Starting Retell Functions Test Suite', 'cyan');
    log(`API Base URL: ${API_BASE_URL}`, 'cyan');
    log(`Merchant ID: ${MERCHANT_ID}`, 'cyan');

    // Check if server is running
    try {
        const healthCheck = await axios.get(`${API_BASE_URL}/health`);
        log(`✅ Server is running (${healthCheck.status})`, 'green');
    } catch (error) {
        log(`❌ Server is not running at ${API_BASE_URL}`, 'red');
        log(`   Make sure your server is running: npm start`, 'yellow');
        process.exit(1);
    }

    // Run tests in order
    await testCollectInsurance();
    await testGetAvailableSlots();
    await testScheduleAppointment();
    await testSearchAppointments();
    await testConfirmAppointment();
    await testCancelAppointment();
    await testRescheduleAppointment();
    await testCreateAppointmentCheckout();
    await testVerifyCheckoutCode();
    await testGetPatientClaims();

    // Print summary
    log(`\n${'='.repeat(80)}`, 'cyan');
    log('📊 TEST SUMMARY', 'cyan');
    log('='.repeat(80), 'cyan');
    log(`✅ Passed: ${results.passed.length}`, 'green');
    log(`❌ Failed: ${results.failed.length}`, 'red');

    if (results.failed.length > 0) {
        log('\n❌ Failed Tests:', 'red');
        results.failed.forEach(({ name, error }) => {
            log(`   - ${name}: ${error}`, 'red');
        });
    }

    if (results.passed.length === 10) {
        log('\n🎉 All tests passed!', 'green');
        process.exit(0);
    } else {
        log('\n⚠️  Some tests failed. Review errors above.', 'yellow');
        process.exit(1);
    }
}

// Run tests
runAllTests().catch(error => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    process.exit(1);
});
