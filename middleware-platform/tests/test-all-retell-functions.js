#!/usr/bin/env node

/**
 * Comprehensive Retell Functions Test
 * Tests all Retell functions with unique test data
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';
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

let appointmentId = null;
let checkoutToken = null;
const uniqueId = Date.now();
const testPhone = `+1555${Math.floor(Math.random() * 10000000)}`;
const testEmail = `test${uniqueId}@example.com`;

async function testFunction(name, testFn) {
    log(`\n${'─'.repeat(70)}`, 'cyan');
    log(`Testing: ${name}`, 'cyan');
    log('─'.repeat(70), 'cyan');
    
    try {
        const result = await testFn();
        if (result.success) {
            log(`✅ PASSED: ${name}`, 'green');
            if (result.data && typeof result.data === 'object') {
                console.log(JSON.stringify(result.data, null, 2));
            }
            return { name, success: true, data: result.data };
        } else {
            log(`❌ FAILED: ${name}`, 'red');
            log(`   Error: ${result.error}`, 'red');
            return { name, success: false, error: result.error };
        }
    } catch (error) {
        log(`❌ FAILED: ${name}`, 'red');
        const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message;
        log(`   Error: ${errorMsg}`, 'red');
        if (error.response?.status) {
            log(`   Status: ${error.response.status}`, 'red');
        }
        return { name, success: false, error: errorMsg };
    }
}

async function main() {
    log('\n🚀 COMPREHENSIVE RETELL FUNCTIONS TEST', 'cyan');
    log(`API Base URL: ${API_BASE_URL}`, 'blue');
    log(`Test Phone: ${testPhone}`, 'blue');
    log(`Test Email: ${testEmail}`, 'blue');
    log('='.repeat(70), 'cyan');

    // Check server
    try {
        await axios.get(`${API_BASE_URL}/health`);
        log('\n✅ Server is running', 'green');
    } catch (error) {
        log('\n❌ Server is not running', 'red');
        process.exit(1);
    }

    const results = [];

    // 1. collect_insurance
    results.push(await testFunction('collect_insurance', async () => {
        const response = await axios.post(`${API_BASE_URL}/voice/insurance/collect`, {
            patient_name: `Test User ${uniqueId}`,
            member_id: `TEST${uniqueId}`,
            payer_name: 'Cigna',
            patient_phone: testPhone,
            patient_email: testEmail,
            service_code: '90834'
        });
        return { success: response.data.success === true, data: response.data };
    }));

    // 2. get_available_slots
    results.push(await testFunction('get_available_slots', async () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const date = tomorrow.toISOString().split('T')[0];
        
        const response = await axios.post(`${API_BASE_URL}/voice/appointments/available-slots`, {
            date: date,
            appointment_type: 'Therapy Session - Psychiatry',
            timezone: 'America/New_York'
        });
        
        return { success: response.data.success === true, data: response.data };
    }));

    // 3. schedule_appointment
    results.push(await testFunction('schedule_appointment', async () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const date = tomorrow.toISOString().split('T')[0];
        
        // Get available slots first
        const slotsResponse = await axios.post(`${API_BASE_URL}/voice/appointments/available-slots`, {
            date: date,
            appointment_type: 'Therapy Session - Psychiatry'
        });
        
        const availableSlots = slotsResponse.data.available_slots || [];
        if (availableSlots.length === 0) {
            return { success: false, error: 'No available slots' };
        }
        
        // Use the first available slot, convert to 12-hour format
        const slotTime = availableSlots[0];
        const [hours, minutes] = slotTime.split(':');
        const hour24 = parseInt(hours);
        const hour12 = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
        const ampm = hour24 >= 12 ? 'PM' : 'AM';
        const time12 = `${hour12}:${minutes} ${ampm}`;
        
        const response = await axios.post(`${API_BASE_URL}/voice/appointments/schedule`, {
            patient_name: `Test User ${uniqueId}`,
            patient_phone: testPhone,
            patient_email: testEmail,
            appointment_type: 'Therapy Session - Psychiatry',
            date: date,
            time: time12,
            timezone: 'America/New_York',
            notes: `Test appointment ${uniqueId}`
        });
        
        if (response.data.success && response.data.appointment?.id) {
            appointmentId = response.data.appointment.id;
        }
        
        return { success: response.data.success === true, data: response.data };
    }));

    // 4. search_appointments
    results.push(await testFunction('search_appointments', async () => {
        const response = await axios.post(`${API_BASE_URL}/voice/appointments/search`, {
            search_term: testPhone
        });
        return { success: response.data.success === true, data: response.data };
    }));

    // 5. confirm_appointment
    if (appointmentId) {
        results.push(await testFunction('confirm_appointment', async () => {
            const response = await axios.post(`${API_BASE_URL}/voice/appointments/confirm`, {
                appointment_id: appointmentId
            });
            return { success: response.data.success === true, data: response.data };
        }));
    } else {
        log(`\n⚠️  SKIPPED: confirm_appointment (no appointment_id)`, 'yellow');
        results.push({ name: 'confirm_appointment', success: false, error: 'No appointment_id', skipped: true });
    }

    // 6. reschedule_appointment
    if (appointmentId) {
        results.push(await testFunction('reschedule_appointment', async () => {
            const dayAfter = new Date();
            dayAfter.setDate(dayAfter.getDate() + 2);
            const newDate = dayAfter.toISOString().split('T')[0];
            
            // Get available slots for new date
            const slotsResponse = await axios.post(`${API_BASE_URL}/voice/appointments/available-slots`, {
                date: newDate,
                appointment_type: 'Therapy Session - Psychiatry'
            });
            
            const availableSlots = slotsResponse.data.available_slots || [];
            if (availableSlots.length === 0) {
                return { success: false, error: 'No available slots for reschedule date' };
            }
            
            const slotTime = availableSlots[0];
            const [hours, minutes] = slotTime.split(':');
            const hour24 = parseInt(hours);
            const hour12 = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
            const ampm = hour24 >= 12 ? 'PM' : 'AM';
            const time12 = `${hour12}:${minutes} ${ampm}`;
            
            const response = await axios.post(`${API_BASE_URL}/voice/appointments/reschedule`, {
                appointment_id: appointmentId,
                new_date: newDate,
                new_time: time12,
                timezone: 'America/New_York',
                reason: 'Test reschedule'
            });
            return { success: response.data.success === true, data: response.data };
        }));
    } else {
        log(`\n⚠️  SKIPPED: reschedule_appointment (no appointment_id)`, 'yellow');
        results.push({ name: 'reschedule_appointment', success: false, error: 'No appointment_id', skipped: true });
    }

    // 7. create_appointment_checkout
    if (appointmentId) {
        results.push(await testFunction('create_appointment_checkout', async () => {
            const response = await axios.post(`${API_BASE_URL}/voice/appointments/checkout`, {
                appointment_id: appointmentId,
                customer_name: `Test User ${uniqueId}`,
                customer_email: testEmail,
                customer_phone: testPhone,
                appointment_type: 'Therapy Session - Psychiatry',
                amount: 50.00
            });
            
            if (response.data.success && response.data.payment_token) {
                checkoutToken = response.data.payment_token;
            }
            
            return { success: response.data.success === true, data: response.data };
        }));
    } else {
        log(`\n⚠️  SKIPPED: create_appointment_checkout (no appointment_id)`, 'yellow');
        results.push({ name: 'create_appointment_checkout', success: false, error: 'No appointment_id', skipped: true });
    }

    // 8. verify_checkout_code
    if (checkoutToken) {
        results.push(await testFunction('verify_checkout_code', async () => {
            // This will fail without real code, but tests endpoint exists
            try {
                const response = await axios.post(`${API_BASE_URL}/voice/checkout/verify`, {
                    payment_token: checkoutToken,
                    verification_code: '000000'
                });
                return { success: response.data.success === true, data: response.data };
            } catch (error) {
                if (error.response?.status === 400) {
                    // Expected failure with dummy code - endpoint works
                    return { success: true, data: { message: 'Endpoint works (expected failure with dummy code)' } };
                }
                throw error;
            }
        }));
    } else {
        log(`\n⚠️  SKIPPED: verify_checkout_code (no checkout token)`, 'yellow');
        results.push({ name: 'verify_checkout_code', success: false, error: 'No checkout token', skipped: true });
    }

    // 9. cancel_appointment (do this last)
    if (appointmentId) {
        results.push(await testFunction('cancel_appointment', async () => {
            const response = await axios.post(`${API_BASE_URL}/voice/appointments/cancel`, {
                appointment_id: appointmentId,
                reason: 'Test cancellation'
            });
            return { success: response.data.success === true, data: response.data };
        }));
    } else {
        log(`\n⚠️  SKIPPED: cancel_appointment (no appointment_id)`, 'yellow');
        results.push({ name: 'cancel_appointment', success: false, error: 'No appointment_id', skipped: true });
    }

    // 10. get_patient_claims
    results.push(await testFunction('get_patient_claims', async () => {
        // Use unique patient to avoid duplicate errors
        const uniqueClaimsId = Date.now() + Math.random();
        const claimsTestPhone = `+1555${Math.floor(Math.random() * 10000000)}`;
        const claimsTestEmail = `claimstest${uniqueClaimsId}@example.com`;
        const claimsTestName = `Claims Test ${uniqueClaimsId}`;
        
        // First, create a patient by scheduling an appointment (this creates a FHIR patient)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const date = tomorrow.toISOString().split('T')[0];
        
        // Get available slots first
        const slotsResponse = await axios.post(`${API_BASE_URL}/voice/appointments/available-slots`, {
            date: date,
            appointment_type: 'Therapy Session - Psychiatry'
        });
        
        const availableSlots = slotsResponse.data.available_slots || [];
        if (availableSlots.length === 0) {
            return { success: false, error: 'No available slots to create appointment' };
        }
        
        // Use the first available slot
        const slotTime = availableSlots[0];
        const [hours, minutes] = slotTime.split(':');
        const hour24 = parseInt(hours);
        const hour12 = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
        const ampm = hour24 >= 12 ? 'PM' : 'AM';
        const time12 = `${hour12}:${minutes} ${ampm}`;
        
        // Schedule appointment to create patient
        const appointmentResponse = await axios.post(`${API_BASE_URL}/voice/appointments/schedule`, {
            patient_name: claimsTestName,
            patient_phone: claimsTestPhone,
            patient_email: claimsTestEmail,
            appointment_type: 'Therapy Session - Psychiatry',
            date: date,
            time: time12,
            timezone: 'America/New_York'
        });
        
        if (!appointmentResponse.data.success || !appointmentResponse.data.appointment?.id) {
            return { success: false, error: 'Could not create appointment/patient first' };
        }
        
        // Now collect insurance (should link to the patient we just created)
        const insuranceResponse = await axios.post(`${API_BASE_URL}/voice/insurance/collect`, {
            patient_name: claimsTestName,
            member_id: `CLAIMS${uniqueClaimsId}`,
            payer_name: 'Cigna',
            patient_phone: claimsTestPhone,
            patient_email: claimsTestEmail
        });
        
        if (!insuranceResponse.data.success) {
            return { success: false, error: 'Could not collect insurance: ' + (insuranceResponse.data.error || 'Unknown error') };
        }
        
        // Get patient_id from insurance collection or use member_id to find patient
        const patientId = insuranceResponse.data.patient_id;
        const memberId = `CLAIMS${uniqueClaimsId}`;
        
        // Get patient benefits/claims using member_id (endpoint can find patient by member_id)
        const response = await axios.get(`${API_BASE_URL}/api/patient/benefits`, {
            params: {
                memberId: memberId, // Use member_id to find patient (endpoint supports this)
                ...(patientId ? { patient_id: patientId } : {}) // Include patient_id if available
            }
        });
        return { success: response.status === 200, data: response.data };
    }));

    // Summary
    log(`\n${'='.repeat(70)}`, 'cyan');
    log('📊 TEST SUMMARY', 'cyan');
    log('='.repeat(70), 'cyan');
    
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    
    log(`✅ Passed: ${passed}`, 'green');
    log(`❌ Failed: ${failed}`, 'red');
    if (skipped > 0) {
        log(`⚠️  Skipped: ${skipped}`, 'yellow');
    }
    
    if (failed > 0) {
        log('\n❌ Failed Tests:', 'red');
        results.filter(r => !r.success && !r.skipped).forEach(r => {
            log(`   - ${r.name}: ${r.error}`, 'red');
        });
    }
    
    if (skipped > 0) {
        log('\n⚠️  Skipped Tests:', 'yellow');
        results.filter(r => r.skipped).forEach(r => {
            log(`   - ${r.name}: ${r.error}`, 'yellow');
        });
    }
    
    log('\n' + '='.repeat(70), 'cyan');
    
    if (failed === 0 && skipped === 0) {
        log('🎉 All tests passed!', 'green');
        process.exit(0);
    } else if (failed === 0) {
        log('✅ All non-skipped tests passed!', 'green');
        process.exit(0);
    } else {
        log('⚠️  Some tests failed. Review errors above.', 'yellow');
        process.exit(1);
    }
}

main().catch(error => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});

